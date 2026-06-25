import type { createAdminClient } from "@/lib/supabase/admin";
import { reclassifyTtCategory } from "@/lib/tt-classification";
import {
  computeScheduledDepartures,
  type ScheduledRiderInput,
} from "@/lib/tt-live";
import { loadStartOrder, type StartOrderEntry } from "@/lib/tt-start-order";

/**
 * TT finish-line write path (Story 18).
 *
 * The finish-line operator taps STOP as each rider crosses the line and then
 * assigns the captured instant to a bib. STOP captures an absolute finish
 * timestamp client-side (`finish_at`, ms epoch / ISO). The rider's **net
 * time** for a time trial is the elapsed duration from that rider's *own*
 * scheduled departure to the finish instant — NOT from the session anchor —
 * because every rider departs at a different re-anchored time
 * (`lib/tt-live.computeScheduledDepartures`).
 *
 * Storage shape (must stay aligned with Story 08 `lib/results.upsertResult`
 * and Story 10/14 GC, which sum `net_seconds`):
 *   - `finish_time`    = absolute finish timestamp (ISO `timestamptz`).
 *   - `elapsed_seconds`= `net_seconds` = (finish − scheduled departure) seconds.
 *   - `net_seconds`    = same value (no separate bonus/penalty for a TT), so GC
 *                        sums it across stages exactly like a manual entry.
 *   - `status`         = "finished"; `position` is assigned by Story 19's
 *                        per-category re-rank (`lib/tt-classification.ts`),
 *                        which runs here right after the upsert.
 *
 * The net seconds are computed **server-side** from the persisted start order
 * re-anchored to the session anchor (`stage_category_starts.started_at`), so
 * the client only needs to send the bib + the captured finish instant and the
 * authoritative timing math lives in one place.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type TtFinishResolve =
  | {
      ok: true;
      registration_id: string;
      bib_number: number | null;
      net_seconds: number;
    }
  | { ok: false; error: string };

/** Reads the session anchor (earliest `started_at`) or null if not started. */
export async function loadSessionAnchor(
  admin: Admin,
  stageId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("stage_category_starts")
    .select("started_at")
    .eq("stage_id", stageId)
    .order("started_at", { ascending: true })
    .limit(1);
  return data?.[0]?.started_at ?? null;
}

/** Maps start-order entries to the shape `computeScheduledDepartures` needs. */
export function toScheduledInputs(
  entries: readonly StartOrderEntry[],
): ScheduledRiderInput[] {
  return entries.map((e) => ({
    registration_id: e.registration_id,
    position: e.position,
    start_time: e.start_time,
    bib_number: e.bib_number,
    rider_name: e.rider_name,
    category_id: e.category_id,
    category_name: e.category_name,
  }));
}

/**
 * Resolves a captured finish instant + bib into a stored `finished` result,
 * computing net seconds from the rider's re-anchored scheduled departure.
 *
 * Validation:
 *   - The bib must exist in the stage start order (else inline error upstream).
 *   - The session must have started (anchor present) and the rider must have a
 *     scheduled departure (a planned `start_time`).
 *   - Net time must be non-negative (a STOP before the rider's departure is a
 *     mis-tap; rejected so it can't poison GC).
 *
 * Conflict resolution (Story 15): keyed by `unique (stage_id, registration_id)`
 * the row is upserted; the later `captured_at` write wins (last write wins) so
 * a duplicate STOP/overwrite assigns the most recent assignment. The endpoint
 * decides whether to allow an overwrite (the client confirms first).
 */
export async function resolveTtFinish(
  admin: Admin,
  stageId: string,
  params: {
    bib_number: number;
    /** Absolute finish instant captured at STOP (ISO). */
    finish_at: string;
    captured_at: string;
  },
): Promise<TtFinishResolve> {
  const finishMs = new Date(params.finish_at).getTime();
  if (Number.isNaN(finishMs)) {
    return { ok: false, error: "Marca de tiempo de llegada no válida." };
  }

  const anchor = await loadSessionAnchor(admin, stageId);
  if (!anchor) {
    return { ok: false, error: "La sesión de contrarreloj aún no ha iniciado." };
  }

  const entries = await loadStartOrder(admin, stageId);
  const target = entries.find((e) => e.bib_number === params.bib_number);
  if (!target) {
    return {
      ok: false,
      error: `El dorsal ${params.bib_number} no está en la lista de salida.`,
    };
  }

  const scheduled = computeScheduledDepartures(toScheduledInputs(entries), anchor);
  const rider = scheduled.find(
    (r) => r.registration_id === target.registration_id,
  );
  if (!rider) {
    return {
      ok: false,
      error: `El dorsal ${params.bib_number} no tiene una hora de salida programada.`,
    };
  }

  const netSeconds = Math.round((finishMs - rider.scheduledAt) / 1000);
  if (netSeconds < 0) {
    return {
      ok: false,
      error:
        "El tiempo de llegada es anterior a la salida del corredor. Revisa el dorsal.",
    };
  }

  const { error } = await admin.from("results").upsert(
    {
      stage_id: stageId,
      registration_id: target.registration_id,
      status: "finished",
      finish_time: new Date(finishMs).toISOString(),
      elapsed_seconds: netSeconds,
      net_seconds: netSeconds,
      position: null,
      dnf_reason: null,
      dsq_reason: null,
      captured_at: params.captured_at,
    },
    { onConflict: "stage_id,registration_id" },
  );

  if (error) {
    return {
      ok: false,
      error: "No se pudo guardar el resultado. Inténtalo de nuevo.",
    };
  }

  // Story 19: re-rank this rider's category by net time and persist positions.
  // GC is computed-on-read by the public page (Story 14) from the same
  // `results` rows it subscribes to, so this position write (and the upsert
  // above) already propagate to the public stage results + GC tab via Realtime
  // — no separate GC write/broadcast is needed.
  const classification = await reclassifyTtCategory(
    admin,
    stageId,
    target.registration_id,
  );
  if (!classification.ok) {
    return { ok: false, error: classification.error };
  }

  return {
    ok: true,
    registration_id: target.registration_id,
    bib_number: target.bib_number,
    net_seconds: netSeconds,
  };
}

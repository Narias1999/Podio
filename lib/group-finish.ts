import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Group/road-stage finish-line write path (Story 21).
 *
 * The finish-line operator taps STOP as each *group* of riders crosses the
 * line, adds every bib in that group, orders them within the group, and saves.
 * Saving enqueues ONE result write per rider (Story 21 view), each POSTed here.
 *
 * Unlike a TT (every rider departs at a re-anchored individual time —
 * `lib/tt-finish.ts`), a group rider's **net time** is measured against THEIR
 * category's wave start: `net_seconds = finish_instant − category.started_at`.
 * Each wave (`stage_category_starts` row) carries its own `started_at`, so two
 * riders in the same finishing group but different categories can have
 * different net times. The finish instant is the same shared captured time for
 * everyone in the group.
 *
 * Storage shape (must stay aligned with Story 14 public results
 * `lib/public-results.ts` and Story 10/14 GC `lib/gc.ts`, which read/sum
 * `net_seconds`, and with Story 22 group classification, which orders within a
 * group by `group_position`):
 *   - `finish_time`    = absolute finish timestamp (ISO `timestamptz`).
 *   - `elapsed_seconds`= the SHARED group elapsed time = `finish − earliest
 *                        started_at in this stage` (same for every rider in the
 *                        group regardless of wave). Story 22 §"Finish time".
 *   - `net_seconds`    = `elapsed_seconds − category_start_offset`, where the
 *                        offset = `(category started_at − earliest started_at)`.
 *                        Algebraically `finish − category started_at`, the
 *                        authoritative ranking/GC value. GC sums it across
 *                        stages exactly like a TT / manual entry.
 *   - `group_position` = the rider's within-group finishing order (1-based) as
 *                        set by the operator (left/first chip = 1). Story 22
 *                        uses it as the within-same-time tiebreak.
 *   - `status`         = "finished"; `position` is assigned by Story 22's
 *                        per-category re-rank (`lib/group-classification.ts`),
 *                        which runs in the route right after these upserts.
 *
 * Story 22 reconciliation: Story 21 stored the per-category net value in
 * `elapsed_seconds`; Story 22 redefines `elapsed_seconds` as the shared group
 * elapsed time (above). `net_seconds` is unchanged (`finish − category start`),
 * so GC / public results / TT are unaffected — they read `net_seconds` only and
 * never `elapsed_seconds`. Only group-stage `elapsed_seconds` changes here; TT
 * (`lib/tt-finish.ts`) still stores `elapsed_seconds = net_seconds`.
 *
 * Missing start time (Story 22 §edge cases): if the rider's category has no
 * `stage_category_starts.started_at` (operator forgot that wave), the result is
 * saved with `net_seconds = null` (and `elapsed_seconds = null`, since the
 * shared elapsed still needs an anchor) and flagged so the organizer results
 * screen warns. The rider is excluded from ranking until the start is recorded.
 *
 * Upsert is idempotent on `unique (stage_id, registration_id)`; the later
 * `captured_at` write wins (last write wins) so an overwrite (the UI confirms
 * first) re-assigns the most recent capture.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Postgres transient-conflict SQLSTATEs (serialization failure / deadlock).
 * Group saves flush one POST per rider concurrently; two upserts into the same
 * stage's `results` table can briefly collide and Postgres aborts one of them.
 * The upsert is idempotent on (stage_id, registration_id), so re-running it is
 * safe and resolves the conflict without surfacing a hard error to the queue
 * (which would otherwise leave that rider unsynced until a later retry).
 */
const TRANSIENT_PG_CODES = new Set(["40001", "40P01"]);

/**
 * Run an idempotent Supabase write, retrying a few times on a transient
 * serialization/deadlock error. The factory is re-invoked each attempt because
 * Supabase query builders are single-use.
 */
async function withTransientRetry<T extends { error: { code?: string | null } | null }>(
  run: () => PromiseLike<T>,
  attempts = 4,
): Promise<T> {
  let result = await run();
  for (
    let i = 1;
    i < attempts &&
    !!result.error?.code &&
    TRANSIENT_PG_CODES.has(result.error.code);
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 25 * i + Math.random() * 25));
    result = await run();
  }
  return result;
}

export type GroupFinishResolve =
  | {
      ok: true;
      registration_id: string;
      bib_number: number | null;
      /** Null when the rider's category never started (missing-start case). */
      net_seconds: number | null;
      group_position: number | null;
      /** The rider's category, so the route can re-rank every touched one. */
      category_id: string;
      /**
       * True when the rider's category had no recorded `started_at`, so net
       * time could not be computed and the result was saved with null times.
       * The organizer screen surfaces a warning for these rows.
       */
      missing_start: boolean;
    }
  | { ok: false; error: string };

/** Reads the earliest `started_at` across the stage (the group elapsed anchor). */
async function loadStageAnchor(
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

/**
 * Resolves a captured finish instant + bib (+ within-group order) into a stored
 * `finished` result.
 *
 * Times (Story 22 §"Net time calculation"):
 *   - `elapsed_seconds` = `finish − earliest started_at in the stage` (shared by
 *     the whole group, regardless of category/wave).
 *   - `net_seconds` = `elapsed_seconds − category_start_offset`, where the offset
 *     is `(category started_at − earliest started_at)`. This equals
 *     `finish − category started_at`, so net time / GC match Story 21.
 *
 * Validation:
 *   - The bib must map to a confirmed registration in this stage's race.
 *   - If the rider's category has NO `started_at` (operator forgot that wave),
 *     the result is still saved but with null `net_seconds`/`elapsed_seconds`
 *     and `missing_start: true` so the organizer screen can warn — it is NOT
 *     rejected (Story 22 changes Story 21's reject behaviour here).
 *   - Net time must be non-negative (a STOP before the wave start is a mis-tap;
 *     rejected so it can't poison GC).
 */
export async function resolveGroupFinish(
  admin: Admin,
  stageId: string,
  raceId: string,
  params: {
    bib_number: number;
    /** Absolute finish instant captured at STOP (ISO). Shared by the group. */
    finish_at: string;
    captured_at: string;
    /** Within-group finishing order (1-based). */
    group_position: number | null;
  },
): Promise<GroupFinishResolve> {
  const finishMs = new Date(params.finish_at).getTime();
  if (Number.isNaN(finishMs)) {
    return { ok: false, error: "Marca de tiempo de llegada no válida." };
  }

  // Resolve the bib → registration (scoped to the stage's race) + its category.
  const { data: registration } = await admin
    .from("registrations")
    .select("id, category_id, bib_number")
    .eq("race_id", raceId)
    .eq("bib_number", params.bib_number)
    .maybeSingle();

  if (!registration) {
    return {
      ok: false,
      error: `El dorsal ${params.bib_number} no está registrado en esta carrera.`,
    };
  }

  // Net time is measured against THIS rider's category wave start; the shared
  // group elapsed is measured against the earliest start across the stage.
  const [{ data: start }, anchorIso] = await Promise.all([
    admin
      .from("stage_category_starts")
      .select("started_at")
      .eq("stage_id", stageId)
      .eq("category_id", registration.category_id)
      .maybeSingle(),
    loadStageAnchor(admin, stageId),
  ]);

  // Missing start: the rider's category never started. Save with null times and
  // flag so the organizer screen warns (Story 22 §edge cases). Excluded from
  // ranking (null net_seconds) until the start is recorded.
  if (!start || !start.started_at) {
    const { error } = await withTransientRetry(() =>
      admin.from("results").upsert(
        {
          stage_id: stageId,
          registration_id: registration.id,
          status: "finished",
          finish_time: new Date(finishMs).toISOString(),
          elapsed_seconds: null,
          net_seconds: null,
          position: null,
          group_position: params.group_position,
          dnf_reason: null,
          dsq_reason: null,
          captured_at: params.captured_at,
        },
        { onConflict: "stage_id,registration_id" },
      ),
    );

    if (error) {
      return {
        ok: false,
        error: "No se pudo guardar el resultado. Inténtalo de nuevo.",
      };
    }

    return {
      ok: true,
      registration_id: registration.id,
      bib_number: registration.bib_number,
      net_seconds: null,
      group_position: params.group_position,
      category_id: registration.category_id,
      missing_start: true,
    };
  }

  const startMs = new Date(start.started_at).getTime();
  if (Number.isNaN(startMs)) {
    return { ok: false, error: "Marca de tiempo de salida no válida." };
  }

  const netSeconds = Math.round((finishMs - startMs) / 1000);
  if (netSeconds < 0) {
    return {
      ok: false,
      error:
        "El tiempo de llegada es anterior a la salida de la categoría. Revisa el dorsal.",
    };
  }

  // Shared group elapsed = finish − earliest stage start. The anchor always
  // exists here (this category started, so at least one start row exists);
  // fall back to this category's start if it somehow can't be read.
  const anchorMs = anchorIso ? new Date(anchorIso).getTime() : startMs;
  const elapsedSeconds = Math.round(
    (finishMs - (Number.isNaN(anchorMs) ? startMs : anchorMs)) / 1000,
  );

  const { error } = await withTransientRetry(() =>
    admin.from("results").upsert(
      {
        stage_id: stageId,
        registration_id: registration.id,
        status: "finished",
        finish_time: new Date(finishMs).toISOString(),
        elapsed_seconds: elapsedSeconds,
        net_seconds: netSeconds,
        position: null,
        group_position: params.group_position,
        dnf_reason: null,
        dsq_reason: null,
        captured_at: params.captured_at,
      },
      { onConflict: "stage_id,registration_id" },
    ),
  );

  if (error) {
    return {
      ok: false,
      error: "No se pudo guardar el resultado. Inténtalo de nuevo.",
    };
  }

  return {
    ok: true,
    registration_id: registration.id,
    bib_number: registration.bib_number,
    net_seconds: netSeconds,
    group_position: params.group_position,
    category_id: registration.category_id,
    missing_start: false,
  };
}

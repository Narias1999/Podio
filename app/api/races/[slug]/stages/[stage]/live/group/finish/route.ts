import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { getOrganizationId } from "@/lib/organizations";
import { resolveGroupFinish } from "@/lib/group-finish";
import { reclassifyGroupCategories } from "@/lib/group-classification";

// POST /api/races/[slug]/stages/[stage]/live/group/finish — records a group's
// group-stage finish (Story 21/22). The finish-line operator taps STOP for a
// group, adds bibs, orders them, and saves; the view enqueues ONE batched write
// for the whole group and the write queue (Story 15) flushes it here.
//
// Body (BATCHED, current shape):
//   { stage_id, finish_at /* shared group STOP instant, ISO */, captured_at,
//     riders: [{ bib_number, group_position /* 1-based, optional */ }, …] }.
// Body (LEGACY single-rider shape — still accepted for any entries already
// queued in a browser before this change):
//   { stage_id, bib_number, finish_at, group_position, captured_at }.
//
// The server computes net_seconds = finish − the rider's category wave start
// (`stage_category_starts.started_at` for that category — see lib/group-finish),
// keeping GC (Story 10/14) and the public page (Story 14) consistent with what
// TT finish (Story 18) / manual entry (Story 08) write.
//
// Why sequential, not concurrent: a batched group is processed by awaiting
// `resolveGroupFinish` one rider at a time, then a SINGLE `reclassifyGroupCategories`
// over every touched category. This removes the in-group concurrency that
// previously let two same-stage `results` upserts collide in Postgres
// (serialization failure / deadlock) and leave a group saved partially.
//
// Authorization: authenticate the session, confirm the race belongs to the
// caller's organization, then write with the service-role client (RLS is off —
// Story 01).
//
// Write-queue endpoint routing: the group-finish view enqueues with an explicit
// `endpoint` override pointing here (the same approach Story 20's group-start
// used) so `results:upsert` never collides with the TT finish endpoint the
// global registry maps that pair to. See Story 15 `QueueEntry.endpoint`.
//
// Upsert keyed by unique (stage_id, registration_id); the later captured_at
// write wins (last-write-wins). Overwrites are intentional — the finish-line UI
// confirms before re-assigning a bib that already has a result.

type RiderInput = {
  bib_number?: unknown;
  group_position?: unknown;
};

type FinishPayload = {
  stage_id?: unknown;
  bib_number?: unknown;
  finish_at?: unknown;
  group_position?: unknown;
  captured_at?: unknown;
  /** Batched shape: a non-empty array of riders sharing finish_at/captured_at. */
  riders?: unknown;
};

/** A validated rider extracted from either body shape. */
type ParsedRider = {
  bib_number: number;
  group_position: number | null;
};

/**
 * Parses + validates a single rider (`bib_number` required integer ≥ 0;
 * `group_position` optional positive int). Returns the parsed rider or a Spanish
 * error message. Reused for both the legacy single-rider body and every item of
 * the batched `riders` array, so validation stays identical across both shapes.
 */
function parseRider(input: RiderInput): { ok: true; rider: ParsedRider } | { ok: false; error: string } {
  const bibNumber =
    typeof input.bib_number === "number"
      ? input.bib_number
      : Number.parseInt(String(input.bib_number ?? ""), 10);
  if (!Number.isInteger(bibNumber) || bibNumber < 0) {
    return { ok: false, error: "Dorsal no válido." };
  }

  let groupPosition: number | null = null;
  if (input.group_position != null) {
    const parsed =
      typeof input.group_position === "number"
        ? input.group_position
        : Number.parseInt(String(input.group_position), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { ok: false, error: "Posición dentro del grupo no válida." };
    }
    groupPosition = parsed;
  }

  return { ok: true, rider: { bib_number: bibNumber, group_position: groupPosition } };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; stage: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, stage: stageParam } = await params;
  const stageNumber = Number.parseInt(stageParam, 10);
  if (!Number.isInteger(stageNumber)) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  const admin = createAdminClient();
  const organizationId = await getOrganizationId(admin, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }
  const race = await loadOwnedRace(admin, slug, organizationId);
  if (!race) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  const { data: stage } = await admin
    .from("stages")
    .select("id, stage_type, results_locked")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();
  if (!stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  // Group finish only applies to non-TT stage types.
  if (stage.stage_type === "time_trial") {
    return NextResponse.json(
      {
        error:
          "La llegada por grupos no aplica a etapas de contrarreloj. Usa el endpoint de TT.",
      },
      { status: 400 },
    );
  }

  if (stage.results_locked) {
    return NextResponse.json(
      { error: "Los resultados de esta etapa están bloqueados." },
      { status: 409 },
    );
  }

  let body: FinishPayload;
  try {
    body = (await request.json()) as FinishPayload;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  // finish_at and captured_at are shared by the whole group (top-level), the
  // same in both the batched and legacy shapes.
  const finishAt = typeof body.finish_at === "string" ? body.finish_at : null;
  if (!finishAt || Number.isNaN(new Date(finishAt).getTime())) {
    return NextResponse.json(
      { error: "Marca de tiempo de llegada no válida." },
      { status: 400 },
    );
  }

  const capturedAt =
    typeof body.captured_at === "string" ? body.captured_at : finishAt;

  // Determine which body shape we got. The batched shape carries a `riders`
  // array; the legacy shape carries a top-level `bib_number`. Normalise both to
  // a single list of validated riders so the processing path below is shared.
  let parsedRiders: ParsedRider[];
  if (body.riders != null) {
    // Batched shape: a non-empty array of { bib_number, group_position }.
    if (!Array.isArray(body.riders) || body.riders.length === 0) {
      return NextResponse.json(
        { error: "El grupo no contiene corredores." },
        { status: 400 },
      );
    }
    const riders: ParsedRider[] = [];
    for (const item of body.riders) {
      // Reject the WHOLE batch with 400 on any malformed item — the same
      // per-rider validation the legacy single-rider path applies.
      const parsed = parseRider((item ?? {}) as RiderInput);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      riders.push(parsed.rider);
    }
    parsedRiders = riders;
  } else {
    // Legacy single-rider shape (backward-compat for already-queued entries).
    const parsed = parseRider(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    parsedRiders = [parsed.rider];
  }

  // Process riders SEQUENTIALLY — this is the whole point of batching: a single
  // route invocation issues its `results` upserts one after another, so two
  // writes to the same stage's `results` table never run concurrently and the
  // transient serialization/deadlock that caused partial group saves cannot
  // occur within a group. Collect each result so we can re-rank once afterward.
  const summaries: Array<{
    registration_id: string;
    bib_number: number | null;
    net_seconds: number | null;
    group_position: number | null;
    missing_start: boolean;
  }> = [];
  const touchedCategoryIds = new Set<string>();

  for (const rider of parsedRiders) {
    const result = await resolveGroupFinish(admin, stage.id, race.id, {
      bib_number: rider.bib_number,
      finish_at: finishAt,
      captured_at: capturedAt,
      group_position: rider.group_position,
    });

    if (!result.ok) {
      // A bib not registered / mis-tap (finish before start) is a client-side
      // validation gap (the UI checks first); surface it as a 422 so the stale
      // batch retries. The whole batch is idempotent — riders already upserted
      // re-upsert harmlessly on the next attempt. We return before the final
      // reclassify; the retry will rank everything once all riders succeed.
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    touchedCategoryIds.add(result.category_id);
    summaries.push({
      registration_id: result.registration_id,
      bib_number: result.bib_number,
      net_seconds: result.net_seconds,
      group_position: result.group_position,
      missing_start: result.missing_start,
    });
  }

  // Story 22: re-rank EVERY category the group touched (a group can span waves)
  // ONCE, after all upserts succeed, by net time and persist positions. Rows
  // with null net_seconds (missing-start riders) are excluded from ranking.
  // GC is computed-on-read by the public page (Story 14) from the same
  // `results` rows it subscribes to (filtered by stage_id), so these position
  // writes and the finish upserts already propagate to the public stage results
  // + GC tab via Realtime — no separate GC write/broadcast is needed.
  const classification = await reclassifyGroupCategories(admin, stage.id, [
    ...touchedCategoryIds,
  ]);
  if (!classification.ok) {
    return NextResponse.json({ error: classification.error }, { status: 500 });
  }

  return NextResponse.json({ riders: summaries });
}

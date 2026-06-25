import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { resolveGroupFinish } from "@/lib/group-finish";
import { reclassifyGroupCategories } from "@/lib/group-classification";

// POST /api/races/[slug]/stages/[stage]/live/group/finish — records one rider's
// group-stage finish (Story 21). The finish-line operator taps STOP for a group,
// adds bibs, orders them, and saves; the view enqueues ONE write per rider and
// the write queue (Story 15) flushes each here.
//
// Body: { stage_id, bib_number, finish_at /* shared group STOP instant, ISO */,
//         group_position /* within-group order, 1-based */, captured_at }.
// The server computes net_seconds = finish − the rider's category wave start
// (`stage_category_starts.started_at` for that category — see lib/group-finish),
// keeping GC (Story 10/14) and the public page (Story 14) consistent with what
// TT finish (Story 18) / manual entry (Story 08) write.
//
// Authorization: authenticate the session, confirm races.organizer_id matches,
// then write with the service-role client (RLS is off — Story 01).
//
// Write-queue endpoint routing: the group-finish view enqueues with an explicit
// `endpoint` override pointing here (the same approach Story 20's group-start
// used) so `results:upsert` never collides with the TT finish endpoint the
// global registry maps that pair to. See Story 15 `QueueEntry.endpoint`.
//
// Upsert keyed by unique (stage_id, registration_id); the later captured_at
// write wins (last-write-wins). Overwrites are intentional — the finish-line UI
// confirms before re-assigning a bib that already has a result.

type FinishPayload = {
  stage_id?: unknown;
  bib_number?: unknown;
  finish_at?: unknown;
  group_position?: unknown;
  captured_at?: unknown;
};

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
  const race = await loadOwnedRace(admin, slug, user.id);
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

  const bibNumber =
    typeof body.bib_number === "number"
      ? body.bib_number
      : Number.parseInt(String(body.bib_number ?? ""), 10);
  if (!Number.isInteger(bibNumber) || bibNumber < 0) {
    return NextResponse.json({ error: "Dorsal no válido." }, { status: 400 });
  }

  const finishAt = typeof body.finish_at === "string" ? body.finish_at : null;
  if (!finishAt || Number.isNaN(new Date(finishAt).getTime())) {
    return NextResponse.json(
      { error: "Marca de tiempo de llegada no válida." },
      { status: 400 },
    );
  }

  // Within-group order is optional but, when present, must be a positive int.
  let groupPosition: number | null = null;
  if (body.group_position != null) {
    const parsed =
      typeof body.group_position === "number"
        ? body.group_position
        : Number.parseInt(String(body.group_position), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: "Posición dentro del grupo no válida." },
        { status: 400 },
      );
    }
    groupPosition = parsed;
  }

  const capturedAt =
    typeof body.captured_at === "string" ? body.captured_at : finishAt;

  const result = await resolveGroupFinish(admin, stage.id, race.id, {
    bib_number: bibNumber,
    finish_at: finishAt,
    captured_at: capturedAt,
    group_position: groupPosition,
  });

  if (!result.ok) {
    // A bib not registered / mis-tap (finish before start) is a client-side
    // validation gap (the UI checks first); surface it as a 422 so a stale
    // queue entry doesn't silently disappear. A missing category start is no
    // longer rejected here (Story 22) — it saves with null net_seconds + flag.
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // Story 22: re-rank the rider's category (and any other category the group
  // touched — a group can span waves) by net time and persist positions. Rows
  // with null net_seconds (missing-start riders) are excluded from ranking.
  // GC is computed-on-read by the public page (Story 14) from the same
  // `results` rows it subscribes to (filtered by stage_id), so these position
  // writes and the finish upsert already propagate to the public stage results
  // + GC tab via Realtime — no separate GC write/broadcast is needed.
  const classification = await reclassifyGroupCategories(admin, stage.id, [
    result.category_id,
  ]);
  if (!classification.ok) {
    return NextResponse.json({ error: classification.error }, { status: 500 });
  }

  return NextResponse.json({
    registration_id: result.registration_id,
    bib_number: result.bib_number,
    net_seconds: result.net_seconds,
    group_position: result.group_position,
    missing_start: result.missing_start,
  });
}

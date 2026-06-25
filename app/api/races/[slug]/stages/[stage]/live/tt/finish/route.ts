import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { resolveTtFinish } from "@/lib/tt-finish";

// POST /api/races/[slug]/stages/[stage]/live/tt/finish — records a TT finish
// time (Story 18). The finish-line operator taps STOP, assigns the captured
// instant to a bib, and the write queue (Story 15) flushes here.
//
// Body: { bib_number, finish_at /* ISO STOP instant */, captured_at }.
// The server re-anchors the rider's scheduled departure from the persisted
// start order + session anchor and stores net_seconds = finish − departure
// (see lib/tt-finish.ts), keeping GC (Story 10/14) consistent with what
// manual entry (Story 08) writes.
//
// Authorization: authenticate the session, confirm races.organizer_id matches,
// then write with the service-role client (RLS is off — Story 01).
//
// Upsert keyed by unique (stage_id, registration_id); the later captured_at
// write wins (last-write-wins). Overwrites are intentional — the finish-line
// UI confirms before re-assigning a bib that already has a time.

type FinishPayload = {
  stage_id?: unknown;
  bib_number?: unknown;
  finish_at?: unknown;
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

  if (stage.stage_type !== "time_trial") {
    return NextResponse.json(
      { error: "La llegada en vivo solo aplica a etapas de contrarreloj." },
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

  const capturedAt =
    typeof body.captured_at === "string" ? body.captured_at : finishAt;

  const result = await resolveTtFinish(admin, stage.id, {
    bib_number: bibNumber,
    finish_at: finishAt,
    captured_at: capturedAt,
  });

  if (!result.ok) {
    // A bib not in the start order is a client-side validation gap (the UI
    // checks first), but treat it as a 422 so a stale queue entry surfaces.
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({
    registration_id: result.registration_id,
    bib_number: result.bib_number,
    net_seconds: result.net_seconds,
  });
}

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { getOrganizationId } from "@/lib/organizations";
import { loadStartOrder } from "@/lib/tt-start-order";

// POST /api/races/[slug]/stages/[stage]/live/tt/start — records the live TT
// session anchor (Story 17). The start-line operator presses "Start TT"; the
// write queue (Story 15) flushes here. We insert one `stage_category_starts`
// row per category present in the stage's start order, all sharing the same
// authoritative `started_at` instant (the client-captured `captured_at`).
//
// Authorization: authenticate the session, confirm the race belongs to the
// caller's organization, then write with the service-role client (RLS is off —
// Story 01).
//
// Idempotent: `stage_category_starts` has `unique (stage_id, category_id)`, so
// re-pressing Start (or a queue retry) upserts on that constraint rather than
// duplicating. The first press's anchor wins via `ignoreDuplicates` semantics
// is NOT used — we deliberately keep the originally-stored anchor by selecting
// existing rows first and short-circuiting if the session already started.

type StartPayload = {
  /** Authoritative anchor — UTC ISO instant of the Start press. */
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
    .select("id, stage_type")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();
  if (!stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  if (stage.stage_type !== "time_trial") {
    return NextResponse.json(
      { error: "La salida en vivo solo aplica a etapas de contrarreloj." },
      { status: 400 },
    );
  }

  let body: StartPayload;
  try {
    body = (await request.json()) as StartPayload;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const startedAt =
    typeof body.captured_at === "string" ? body.captured_at : null;
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) {
    return NextResponse.json(
      { error: "Marca de tiempo de salida no válida." },
      { status: 400 },
    );
  }

  // Already started? Keep the original anchor (idempotent re-press / retry).
  const { data: existing } = await admin
    .from("stage_category_starts")
    .select("id, category_id, started_at")
    .eq("stage_id", stage.id);
  if (existing && existing.length > 0) {
    return NextResponse.json({ rows: existing, alreadyStarted: true });
  }

  // One anchor row per category present in the start order.
  const entries = await loadStartOrder(admin, stage.id);
  const categoryIds = [...new Set(entries.map((e) => e.category_id))];
  if (categoryIds.length === 0) {
    return NextResponse.json(
      { error: "Aún no se ha generado el orden de salida." },
      { status: 400 },
    );
  }

  const { data: inserted, error: insertError } = await admin
    .from("stage_category_starts")
    .upsert(
      categoryIds.map((category_id) => ({
        stage_id: stage.id,
        category_id,
        started_at: startedAt,
      })),
      { onConflict: "stage_id,category_id", ignoreDuplicates: true },
    )
    .select("id, category_id, started_at");

  if (insertError) {
    return NextResponse.json(
      { error: "No se pudo registrar la salida. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ rows: inserted ?? [], alreadyStarted: false });
}

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";

// POST /api/races/[slug]/stages/[stage]/live/group/start — records one wave of
// group-stage starts (Story 20). The start-line operator selects one or more
// categories and presses "Iniciar"; the write queue (Story 15) flushes here.
//
// Each call writes one `stage_category_starts` row per supplied `category_id`
// using the client-captured `captured_at` as the authoritative `started_at`.
// Multiple waves are supported — each wave may target different categories and
// carries its own distinct `started_at`.
//
// Authorization: authenticate the session, confirm `races.organizer_id`
// matches, then write with the service-role client (RLS is off — Story 01).
//
// Idempotent: `stage_category_starts` has `unique (stage_id, category_id)`, so
// retrying a wave (write-queue replay) upserts on that constraint and
// `ignoreDuplicates: true` keeps the first anchor intact.
//
// Write-queue endpoint routing: the group-start view enqueues with an explicit
// `endpoint` override pointing here, so it never collides with the TT start
// endpoint that the global registry maps `stage_category_starts:upsert` to.
// See Story 15 `lib/write-queue.ts` — `QueueEntry.endpoint` takes precedence
// over the registry when set.

type GroupStartPayload = {
  /** IDs of the categories included in this wave (non-empty). */
  category_ids?: unknown;
  /** Authoritative anchor — UTC ISO instant of the Iniciar press. */
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
    .select("id, stage_type")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();
  if (!stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  // Group start only applies to non-TT stage types.
  if (stage.stage_type === "time_trial") {
    return NextResponse.json(
      {
        error:
          "La salida por grupos no aplica a etapas de contrarreloj. Usa el endpoint de TT.",
      },
      { status: 400 },
    );
  }

  let body: GroupStartPayload;
  try {
    body = (await request.json()) as GroupStartPayload;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  // Validate captured_at.
  const startedAt =
    typeof body.captured_at === "string" ? body.captured_at : null;
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) {
    return NextResponse.json(
      { error: "Marca de tiempo de salida no válida." },
      { status: 400 },
    );
  }

  // Validate category_ids.
  if (
    !Array.isArray(body.category_ids) ||
    body.category_ids.length === 0 ||
    !body.category_ids.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return NextResponse.json(
      { error: "Se requiere al menos una categoría para registrar la salida." },
      { status: 400 },
    );
  }
  const categoryIds = body.category_ids as string[];

  // Confirm all supplied category_ids belong to this race (guard against
  // cross-race writes — no RLS means we must validate manually).
  const { data: validCategories } = await admin
    .from("categories")
    .select("id")
    .eq("race_id", race.id)
    .in("id", categoryIds);

  const validIds = new Set((validCategories ?? []).map((c) => c.id));
  const unknownIds = categoryIds.filter((id) => !validIds.has(id));
  if (unknownIds.length > 0) {
    return NextResponse.json(
      { error: "Una o más categorías no pertenecen a esta carrera." },
      { status: 400 },
    );
  }

  // Upsert one row per category in the wave. `ignoreDuplicates: true` keeps the
  // first anchor if this wave was already committed (queue retry / idempotency).
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

  return NextResponse.json({ rows: inserted ?? [] });
}

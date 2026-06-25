import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { validateStagePayload, type StagePayload } from "@/lib/stages";

// PATCH /api/races/[slug]/stages/[stageId] — edits name/date/distance/type of
// a stage owned by the session user (single- and multi-stage races).
// DELETE /api/races/[slug]/stages/[stageId] — deletes a stage, blocked if the
// stage has results or if it is the race's only stage; remaining stages are
// renumbered to stay contiguous.
// Both authenticate the session, confirm `races.organizer_id` matches, then
// write with the service-role client (RLS is off — Story 01).

async function loadOwnedStage(
  admin: ReturnType<typeof createAdminClient>,
  slug: string,
  stageId: string,
  userId: string,
) {
  const race = await loadOwnedRace(admin, slug, userId);
  if (!race) {
    return { race: null, stage: null } as const;
  }

  const { data: stage } = await admin
    .from("stages")
    .select("*")
    .eq("id", stageId)
    .eq("race_id", race.id)
    .maybeSingle();

  return { race, stage } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; stageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, stageId } = await params;
  const admin = createAdminClient();
  const { race, stage } = await loadOwnedStage(admin, slug, stageId, user.id);

  if (!race || !stage) {
    return NextResponse.json(
      { error: "Etapa no encontrada." },
      { status: 404 },
    );
  }

  let payload: StagePayload;
  try {
    payload = (await request.json()) as StagePayload;
  } catch {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const validationError = validateStagePayload(payload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { data: updated, error: updateError } = await admin
    .from("stages")
    .update({
      name: payload.name.trim(),
      date: payload.date,
      distance_km: payload.distance_km,
      stage_type: payload.stage_type,
    })
    .eq("id", stage.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "No se pudo actualizar la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ stage: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; stageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, stageId } = await params;
  const admin = createAdminClient();
  const { race, stage } = await loadOwnedStage(admin, slug, stageId, user.id);

  if (!race || !stage) {
    return NextResponse.json(
      { error: "Etapa no encontrada." },
      { status: 404 },
    );
  }

  const { count: resultsCount, error: resultsError } = await admin
    .from("results")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stage.id);

  if (resultsError) {
    return NextResponse.json(
      { error: "No se pudo eliminar la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  if ((resultsCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "No se puede eliminar esta etapa porque ya tiene resultados registrados.",
      },
      { status: 409 },
    );
  }

  const { count: totalStages, error: totalError } = await admin
    .from("stages")
    .select("id", { count: "exact", head: true })
    .eq("race_id", race.id);

  if (totalError) {
    return NextResponse.json(
      { error: "No se pudo eliminar la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  if ((totalStages ?? 0) <= 1) {
    return NextResponse.json(
      { error: "La carrera debe tener al menos una etapa." },
      { status: 409 },
    );
  }

  const { error: deleteError } = await admin
    .from("stages")
    .delete()
    .eq("id", stage.id);

  if (deleteError) {
    return NextResponse.json(
      { error: "No se pudo eliminar la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  // Renumber remaining stages to stay contiguous starting at 1.
  const { data: remaining, error: remainingError } = await admin
    .from("stages")
    .select("id, stage_number")
    .eq("race_id", race.id)
    .order("stage_number", { ascending: true });

  if (remainingError || !remaining) {
    return NextResponse.json(
      { error: "No se pudo eliminar la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  for (let i = 0; i < remaining.length; i += 1) {
    const desired = i + 1;
    if (remaining[i].stage_number !== desired) {
      await admin
        .from("stages")
        .update({ stage_number: desired })
        .eq("id", remaining[i].id);
    }
  }

  return NextResponse.json({ ok: true });
}

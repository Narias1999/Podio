import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { validateStagePayload, type StagePayload } from "@/lib/stages";

// GET /api/races/[slug]/stages — lists the stages of a race owned by the
// session user, ordered by stage_number.
// POST /api/races/[slug]/stages — adds a new stage to a multi-stage race
// owned by the session user. The new stage is appended at the end (highest
// stage_number + 1); reordering is handled by the separate reorder endpoint.
// Both authenticate the session, then confirm `races.organizer_id` matches
// before reading/writing with the service-role client (RLS is off — Story 01).

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug } = await params;
  const admin = createAdminClient();
  const race = await loadOwnedRace(admin, slug, user.id);
  if (!race) {
    return NextResponse.json(
      { error: "Carrera no encontrada." },
      { status: 404 },
    );
  }

  const { data: stages, error } = await admin
    .from("stages")
    .select("*")
    .eq("race_id", race.id)
    .order("stage_number", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "No se pudieron cargar las etapas." },
      { status: 500 },
    );
  }

  return NextResponse.json({ stages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug } = await params;
  const admin = createAdminClient();
  const race = await loadOwnedRace(admin, slug, user.id);
  if (!race) {
    return NextResponse.json(
      { error: "Carrera no encontrada." },
      { status: 404 },
    );
  }

  const { data: raceFlags } = await admin
    .from("races")
    .select("is_multi_stage")
    .eq("id", race.id)
    .single();

  if (!raceFlags?.is_multi_stage) {
    return NextResponse.json(
      { error: "Esta carrera es de etapa única; no se pueden agregar etapas." },
      { status: 400 },
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

  const { data: existingStages, error: countError } = await admin
    .from("stages")
    .select("stage_number")
    .eq("race_id", race.id)
    .order("stage_number", { ascending: false })
    .limit(1);

  if (countError) {
    return NextResponse.json(
      { error: "No se pudo crear la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const nextStageNumber = (existingStages?.[0]?.stage_number ?? 0) + 1;

  const { data: stage, error: insertError } = await admin
    .from("stages")
    .insert({
      race_id: race.id,
      stage_number: nextStageNumber,
      name: payload.name.trim(),
      date: payload.date,
      distance_km: payload.distance_km,
      stage_type: payload.stage_type,
    })
    .select("*")
    .single();

  if (insertError || !stage) {
    return NextResponse.json(
      { error: "No se pudo crear la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ stage }, { status: 201 });
}

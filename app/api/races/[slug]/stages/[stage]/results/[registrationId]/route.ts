import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationId } from "@/lib/organizations";
import { loadOwnedRace } from "@/lib/races";
import {
  findDuplicatePositions,
  upsertResult,
  validateResultPayload,
  type ResultPayload,
} from "@/lib/results";

// PUT /api/races/[slug]/stages/[stage]/results/[registrationId] — saves a
// single rider's result on blur or via the per-row Save button (Story 08).
// Authenticates the session, confirms the race belongs to the caller's
// organization, blocks writes when the stage's results are locked, then upserts
// with the service-role client (RLS is off — Story 01).

export async function PUT(
  request: Request,
  {
    params,
  }: { params: Promise<{ slug: string; stage: string; registrationId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, stage: stageParam, registrationId } = await params;
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
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }

  const { data: stage } = await admin
    .from("stages")
    .select("*")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();
  if (!stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  if (stage.results_locked) {
    return NextResponse.json(
      { error: "Los resultados de esta etapa están bloqueados." },
      { status: 409 },
    );
  }

  const { data: registration } = await admin
    .from("registrations")
    .select("id, category_id")
    .eq("id", registrationId)
    .eq("race_id", race.id)
    .maybeSingle();
  if (!registration) {
    return NextResponse.json(
      { error: "Inscripción no encontrada." },
      { status: 404 },
    );
  }

  let payload: ResultPayload;
  try {
    payload = (await request.json()) as ResultPayload;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }
  payload.registration_id = registrationId;

  const validationError = validateResultPayload(payload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (payload.status === "finished" && payload.position !== null) {
    const { data: siblingResults } = await admin
      .from("results")
      .select("registration_id, position, registrations!inner(category_id)")
      .eq("stage_id", stage.id)
      .eq("registrations.category_id", registration.category_id)
      .eq("status", "finished");

    const rowsForDupeCheck = (siblingResults ?? [])
      .filter((r) => r.registration_id !== registrationId)
      .map((r) => ({
        registration_id: r.registration_id,
        category_id: registration.category_id,
        position: r.position,
      }));
    rowsForDupeCheck.push({
      registration_id: registrationId,
      category_id: registration.category_id,
      position: payload.position,
    });

    const duplicates = findDuplicatePositions(rowsForDupeCheck);
    if (duplicates.has(registrationId)) {
      return NextResponse.json(
        { error: "La posición está duplicada dentro de la categoría." },
        { status: 409 },
      );
    }
  }

  const result = await upsertResult(admin, stage.id, payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ result: result.result });
}

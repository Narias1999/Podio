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

// GET /api/races/[slug]/stages/[stage]/results — lists the stage's results
// joined with registration/category info, for the manual results entry
// screen (Story 08).
// PUT /api/races/[slug]/stages/[stage]/results — saves all unsaved rows at
// once ("Save all" button). Each row is validated and upserted individually;
// the route returns per-row errors instead of failing atomically, since
// partial progress is valid per the story.
// Both authenticate the session, confirm the race belongs to the caller's
// organization, then read/write with the service-role client (RLS is off — Story 01).

async function loadOwnedStageByNumber(
  admin: ReturnType<typeof createAdminClient>,
  slug: string,
  stageNumber: number,
  organizationId: string,
) {
  const race = await loadOwnedRace(admin, slug, organizationId);
  if (!race) {
    return { race: null, stage: null } as const;
  }

  const { data: stage } = await admin
    .from("stages")
    .select("*")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  return { race, stage } as const;
}

export async function GET(
  _request: Request,
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
  const { race, stage } = await loadOwnedStageByNumber(
    admin,
    slug,
    stageNumber,
    organizationId,
  );
  if (!race || !stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  const { data: registrations, error: regError } = await admin
    .from("registrations")
    .select(
      "id, bib_number, status, category_id, categories(id, name, sort_order), riders(id, name)",
    )
    .eq("race_id", race.id);

  if (regError) {
    return NextResponse.json(
      { error: "No se pudieron cargar los corredores." },
      { status: 500 },
    );
  }

  const registrationIds = (registrations ?? []).map((r) => r.id);
  let results: Record<string, unknown>[] = [];
  if (registrationIds.length > 0) {
    const { data: resultRows, error: resultsError } = await admin
      .from("results")
      .select("*")
      .eq("stage_id", stage.id)
      .in("registration_id", registrationIds);

    if (resultsError) {
      return NextResponse.json(
        { error: "No se pudieron cargar los resultados." },
        { status: 500 },
      );
    }
    results = resultRows ?? [];
  }

  return NextResponse.json({ stage, registrations: registrations ?? [], results });
}

export async function PUT(
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
  const { race, stage } = await loadOwnedStageByNumber(
    admin,
    slug,
    stageNumber,
    organizationId,
  );
  if (!race || !stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  if (stage.results_locked) {
    return NextResponse.json(
      { error: "Los resultados de esta etapa están bloqueados." },
      { status: 409 },
    );
  }

  let payload: { results: ResultPayload[] };
  try {
    payload = (await request.json()) as { results: ResultPayload[] };
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  // Look up each row's category to check cross-row position uniqueness.
  const { data: registrations } = await admin
    .from("registrations")
    .select("id, category_id")
    .eq("race_id", race.id);
  const categoryByRegistration = new Map(
    (registrations ?? []).map((r) => [r.id, r.category_id]),
  );

  const duplicates = findDuplicatePositions(
    payload.results
      .filter((r) => r.status === "finished")
      .map((r) => ({
        registration_id: r.registration_id,
        category_id: categoryByRegistration.get(r.registration_id) ?? "",
        position: r.position,
      })),
  );

  const errors: Record<string, string> = {};
  const saved: Record<string, unknown>[] = [];

  for (const row of payload.results) {
    if (duplicates.has(row.registration_id)) {
      errors[row.registration_id] =
        "La posición está duplicada dentro de la categoría.";
      continue;
    }
    const validationError = validateResultPayload(row);
    if (validationError) {
      errors[row.registration_id] = validationError;
      continue;
    }
    const result = await upsertResult(admin, stage.id, row);
    if (!result.ok) {
      errors[row.registration_id] = result.error;
      continue;
    }
    saved.push(result.result);
  }

  return NextResponse.json({ results: saved, errors });
}

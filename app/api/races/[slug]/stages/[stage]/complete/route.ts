import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationId } from "@/lib/organizations";
import { loadOwnedRace } from "@/lib/races";

// POST /api/races/[slug]/stages/[stage]/complete — marks the stage's results
// as locked (read-only) once every confirmed, non-DNS rider has a result
// (Story 08). The client gates the button's visibility, but the server
// re-checks the precondition to avoid a stale-client race.
// DELETE — unlocks the stage's results for further editing ("Unlock
// results"), with the confirmation step handled client-side.
// Both authenticate the session, confirm the race belongs to the caller's
// organization, then write with the service-role client (RLS is off — Story 01).

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

export async function POST(
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

  const { data: registrations } = await admin
    .from("registrations")
    .select("id, status")
    .eq("race_id", race.id);

  const nonDnsRegistrationIds = (registrations ?? [])
    .filter((r) => r.status !== "dns")
    .map((r) => r.id);

  if (nonDnsRegistrationIds.length === 0) {
    return NextResponse.json(
      { error: "No hay corredores confirmados para esta etapa." },
      { status: 400 },
    );
  }

  const { data: results } = await admin
    .from("results")
    .select("registration_id")
    .eq("stage_id", stage.id)
    .in("registration_id", nonDnsRegistrationIds);

  const resultRegistrationIds = new Set((results ?? []).map((r) => r.registration_id));
  const missing = nonDnsRegistrationIds.filter(
    (id) => !resultRegistrationIds.has(id),
  );

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error:
          "Todos los corredores confirmados (excepto DNS) deben tener un resultado antes de marcar la etapa como completada.",
      },
      { status: 409 },
    );
  }

  const { data: updated, error: updateError } = await admin
    .from("stages")
    .update({ results_locked: true })
    .eq("id", stage.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "No se pudo completar la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ stage: updated });
}

export async function DELETE(
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

  const { data: updated, error: updateError } = await admin
    .from("stages")
    .update({ results_locked: false })
    .eq("id", stage.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "No se pudo desbloquear la etapa. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ stage: updated });
}

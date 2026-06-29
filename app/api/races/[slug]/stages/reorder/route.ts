import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationId } from "@/lib/organizations";
import { loadOwnedRace } from "@/lib/races";
import { validateReorderPayload, type ReorderPayload } from "@/lib/stages";

// POST /api/races/[slug]/stages/reorder — applies a new stage order for a
// multi-stage race owned by the session user. Body is `{ stage_ids: string[] }`
// listing every stage id of the race in the desired order; stage_number is
// recalculated as 1..N to match. Authenticates the session, confirms the race
// belongs to the caller's organization, then writes with the service-role
// client (RLS is off — Story 01).
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
  const organizationId = await getOrganizationId(admin, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }
  const race = await loadOwnedRace(admin, slug, organizationId);

  if (!race) {
    return NextResponse.json(
      { error: "Carrera no encontrada." },
      { status: 404 },
    );
  }

  let payload: ReorderPayload;
  try {
    payload = (await request.json()) as ReorderPayload;
  } catch {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const { data: existingStages, error: stagesError } = await admin
    .from("stages")
    .select("id")
    .eq("race_id", race.id);

  if (stagesError || !existingStages) {
    return NextResponse.json(
      { error: "No se pudo reordenar las etapas. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const validationError = validateReorderPayload(
    payload,
    existingStages.map((s) => s.id),
  );
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  for (let i = 0; i < payload.stage_ids.length; i += 1) {
    const { error: updateError } = await admin
      .from("stages")
      .update({ stage_number: i + 1 })
      .eq("id", payload.stage_ids[i]);

    if (updateError) {
      return NextResponse.json(
        { error: "No se pudo reordenar las etapas. Inténtalo de nuevo." },
        { status: 500 },
      );
    }
  }

  const { data: stages, error: finalError } = await admin
    .from("stages")
    .select("*")
    .eq("race_id", race.id)
    .order("stage_number", { ascending: true });

  if (finalError) {
    return NextResponse.json(
      { error: "No se pudo reordenar las etapas. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ stages });
}

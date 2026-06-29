import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationId } from "@/lib/organizations";
import { loadOwnedRace } from "@/lib/races";
import {
  createRiderRegistration,
  validateRiderRegistrationPayload,
  type RiderRegistrationPayload,
} from "@/lib/riders";

// POST /api/races/[slug]/riders — registers a rider in a race owned by the
// session user. Creates (or reuses by document_number) the global rider
// profile and links a confirmed registration with the chosen category and an
// empty bib (bibs are assigned later via the close-registration action).
// Authenticates the session, confirms the race belongs to the caller's
// organization, then writes with the service-role client (RLS is off — Story 01).

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

  let payload: RiderRegistrationPayload;
  try {
    payload = (await request.json()) as RiderRegistrationPayload;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const { data: categories, error: categoriesError } = await admin
    .from("categories")
    .select("id")
    .eq("race_id", race.id);

  if (categoriesError) {
    return NextResponse.json(
      { error: "No se pudo registrar el corredor. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const validationError = validateRiderRegistrationPayload(
    payload,
    (categories ?? []).map((c) => c.id),
  );
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const result = await createRiderRegistration(admin, race.id, payload);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json(
    { rider: result.rider, registration: result.registration },
    { status: 201 },
  );
}

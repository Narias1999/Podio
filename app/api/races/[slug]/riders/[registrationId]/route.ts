import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationId } from "@/lib/organizations";
import { loadOwnedRace } from "@/lib/races";
import type { RegistrationUpdatePayload } from "@/lib/riders";

// PATCH /api/races/[slug]/riders/[registrationId] — updates the editable
// fields of a registration (category, team/eps/phone/nationality on the rider
// profile, status, and — once registration is closed — the bib number).
// DELETE /api/races/[slug]/riders/[registrationId] — removes a registration,
// blocked when the rider has results recorded for any stage of the race.
// Both authenticate the session, confirm the race belongs to the caller's
// organization, then write with the service-role client (RLS is off — Story 01).

async function loadOwnedRegistration(
  admin: ReturnType<typeof createAdminClient>,
  slug: string,
  registrationId: string,
  organizationId: string,
) {
  const race = await loadOwnedRace(admin, slug, organizationId);
  if (!race) {
    return { race: null, registration: null } as const;
  }

  const { data: registration } = await admin
    .from("registrations")
    .select("id, race_id, rider_id, category_id, bib_number, status")
    .eq("id", registrationId)
    .eq("race_id", race.id)
    .maybeSingle();

  return { race, registration } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; registrationId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, registrationId } = await params;
  const admin = createAdminClient();
  const organizationId = await getOrganizationId(admin, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }
  const { race, registration } = await loadOwnedRegistration(
    admin,
    slug,
    registrationId,
    organizationId,
  );

  if (!race || !registration) {
    return NextResponse.json(
      { error: "Inscripción no encontrada." },
      { status: 404 },
    );
  }

  let payload: RegistrationUpdatePayload;
  try {
    payload = (await request.json()) as RegistrationUpdatePayload;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  // Validate category belongs to the race when changing it.
  if (payload.category_id !== undefined) {
    const { data: category } = await admin
      .from("categories")
      .select("id")
      .eq("id", payload.category_id)
      .eq("race_id", race.id)
      .maybeSingle();
    if (!category) {
      return NextResponse.json(
        { error: "La categoría seleccionada no pertenece a esta carrera." },
        { status: 400 },
      );
    }
  }

  if (payload.status !== undefined && payload.status !== "confirmed" && payload.status !== "dns") {
    return NextResponse.json({ error: "Estado no válido." }, { status: 400 });
  }

  // Bib editing: only meaningful once registration is closed; enforce per-race
  // uniqueness with an inline error on a clash.
  if (payload.bib_number !== undefined) {
    if (payload.bib_number !== null) {
      if (!Number.isInteger(payload.bib_number) || payload.bib_number < 1) {
        return NextResponse.json(
          { error: "El dorsal debe ser un número positivo." },
          { status: 400 },
        );
      }
      const { data: clash } = await admin
        .from("registrations")
        .select("id")
        .eq("race_id", race.id)
        .eq("bib_number", payload.bib_number)
        .neq("id", registration.id)
        .maybeSingle();
      if (clash) {
        return NextResponse.json(
          { error: `El dorsal ${payload.bib_number} ya está asignado a otro corredor.` },
          { status: 409 },
        );
      }
    }
  }

  const registrationUpdate: {
    category_id?: string;
    status?: string;
    bib_number?: number | null;
  } = {};
  if (payload.category_id !== undefined) registrationUpdate.category_id = payload.category_id;
  if (payload.status !== undefined) registrationUpdate.status = payload.status;
  if (payload.bib_number !== undefined) registrationUpdate.bib_number = payload.bib_number;

  let updatedRegistration = registration;
  if (Object.keys(registrationUpdate).length > 0) {
    const { data: updated, error: updateError } = await admin
      .from("registrations")
      .update(registrationUpdate)
      .eq("id", registration.id)
      .select("id, race_id, rider_id, category_id, bib_number, status")
      .single();
    if (updateError || !updated) {
      return NextResponse.json(
        { error: "No se pudo actualizar la inscripción. Inténtalo de nuevo." },
        { status: 500 },
      );
    }
    updatedRegistration = updated;
  }

  // Rider-profile fields editable from this panel (team, eps, phone, nationality).
  const riderUpdate: {
    team?: string | null;
    eps?: string | null;
    phone?: string | null;
    nationality?: string | null;
  } = {};
  if (payload.team !== undefined) riderUpdate.team = payload.team?.trim() || null;
  if (payload.eps !== undefined) riderUpdate.eps = payload.eps?.trim() || null;
  if (payload.phone !== undefined) riderUpdate.phone = payload.phone?.trim() || null;
  if (payload.nationality !== undefined)
    riderUpdate.nationality = payload.nationality?.trim() || null;

  let updatedRider = null;
  if (Object.keys(riderUpdate).length > 0) {
    const { data: rider, error: riderError } = await admin
      .from("riders")
      .update(riderUpdate)
      .eq("id", registration.rider_id)
      .select("*")
      .single();
    if (riderError || !rider) {
      return NextResponse.json(
        { error: "No se pudo actualizar la inscripción. Inténtalo de nuevo." },
        { status: 500 },
      );
    }
    updatedRider = rider;
  }

  return NextResponse.json({
    registration: updatedRegistration,
    rider: updatedRider,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; registrationId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, registrationId } = await params;
  const admin = createAdminClient();
  const organizationId = await getOrganizationId(admin, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }
  const { race, registration } = await loadOwnedRegistration(
    admin,
    slug,
    registrationId,
    organizationId,
  );

  if (!race || !registration) {
    return NextResponse.json(
      { error: "Inscripción no encontrada." },
      { status: 404 },
    );
  }

  // Block removal when the rider has results recorded for any stage.
  const { count: resultsCount, error: resultsError } = await admin
    .from("results")
    .select("id", { count: "exact", head: true })
    .eq("registration_id", registration.id);

  if (resultsError) {
    return NextResponse.json(
      { error: "No se pudo eliminar la inscripción. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  if ((resultsCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Este corredor tiene resultados registrados. Elimina primero sus resultados.",
      },
      { status: 409 },
    );
  }

  const { error: deleteError } = await admin
    .from("registrations")
    .delete()
    .eq("id", registration.id);

  if (deleteError) {
    return NextResponse.json(
      { error: "No se pudo eliminar la inscripción. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

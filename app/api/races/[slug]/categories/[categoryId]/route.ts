import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationId } from "@/lib/organizations";
import { loadOwnedRace } from "@/lib/races";
import { validateCategoryPayload, type CategoryPayload } from "@/lib/categories";

// PATCH /api/races/[slug]/categories/[categoryId] — edits name/age range/sex
// of a category owned by the session user. Changing the age/sex rule does
// not retroactively re-assign existing registrations (Story 05).
// DELETE /api/races/[slug]/categories/[categoryId] — deletes a category,
// blocked when it has registrations, with the registered-rider count in the
// error message.
// Both authenticate the session, confirm the race belongs to the caller's
// organization, then write with the service-role client (RLS is off — Story 01).

async function loadOwnedCategory(
  admin: ReturnType<typeof createAdminClient>,
  slug: string,
  categoryId: string,
  organizationId: string,
) {
  const race = await loadOwnedRace(admin, slug, organizationId);
  if (!race) {
    return { race: null, category: null } as const;
  }

  const { data: category } = await admin
    .from("categories")
    .select("*")
    .eq("id", categoryId)
    .eq("race_id", race.id)
    .maybeSingle();

  return { race, category } as const;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; categoryId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, categoryId } = await params;
  const admin = createAdminClient();
  const organizationId = await getOrganizationId(admin, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }
  const { race, category } = await loadOwnedCategory(
    admin,
    slug,
    categoryId,
    organizationId,
  );

  if (!race || !category) {
    return NextResponse.json(
      { error: "Categoría no encontrada." },
      { status: 404 },
    );
  }

  let payload: CategoryPayload;
  try {
    payload = (await request.json()) as CategoryPayload;
  } catch {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const { data: otherCategories, error: othersError } = await admin
    .from("categories")
    .select("name")
    .eq("race_id", race.id)
    .neq("id", category.id);

  if (othersError) {
    return NextResponse.json(
      { error: "No se pudo actualizar la categoría. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const validationError = validateCategoryPayload(
    payload,
    (otherCategories ?? []).map((c) => c.name),
  );
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { data: updated, error: updateError } = await admin
    .from("categories")
    .update({
      name: payload.name.trim(),
      age_min: payload.age_min,
      age_max: payload.age_max,
      sex: payload.sex,
    })
    .eq("id", category.id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "No se pudo actualizar la categoría. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ category: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string; categoryId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, categoryId } = await params;
  const admin = createAdminClient();
  const organizationId = await getOrganizationId(admin, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }
  const { race, category } = await loadOwnedCategory(
    admin,
    slug,
    categoryId,
    organizationId,
  );

  if (!race || !category) {
    return NextResponse.json(
      { error: "Categoría no encontrada." },
      { status: 404 },
    );
  }

  const { count: registrationsCount, error: registrationsError } = await admin
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("category_id", category.id);

  if (registrationsError) {
    return NextResponse.json(
      { error: "No se pudo eliminar la categoría. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  if ((registrationsCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Esta categoría tiene ${registrationsCount} corredores inscritos. Elimínalos primero antes de eliminar la categoría.`,
      },
      { status: 409 },
    );
  }

  const { error: deleteError } = await admin
    .from("categories")
    .delete()
    .eq("id", category.id);

  if (deleteError) {
    return NextResponse.json(
      { error: "No se pudo eliminar la categoría. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

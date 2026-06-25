import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { validateCategoryPayload, type CategoryPayload } from "@/lib/categories";

// GET /api/races/[slug]/categories — lists the categories of a race owned by
// the session user, ordered by sort_order.
// POST /api/races/[slug]/categories — adds a new category to a race owned by
// the session user. The new category is appended at the end (highest
// sort_order + 1); reordering is handled by the separate reorder endpoint.
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

  const { data: categories, error } = await admin
    .from("categories")
    .select("*")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "No se pudieron cargar las categorías." },
      { status: 500 },
    );
  }

  return NextResponse.json({ categories });
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

  let payload: CategoryPayload;
  try {
    payload = (await request.json()) as CategoryPayload;
  } catch {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const { data: existingCategories, error: countError } = await admin
    .from("categories")
    .select("name, sort_order")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: false });

  if (countError) {
    return NextResponse.json(
      { error: "No se pudo crear la categoría. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const validationError = validateCategoryPayload(
    payload,
    (existingCategories ?? []).map((c) => c.name),
  );
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const nextSortOrder = (existingCategories?.[0]?.sort_order ?? -1) + 1;

  const { data: category, error: insertError } = await admin
    .from("categories")
    .insert({
      race_id: race.id,
      sort_order: nextSortOrder,
      name: payload.name.trim(),
      age_min: payload.age_min,
      age_max: payload.age_max,
      sex: payload.sex,
    })
    .select("*")
    .single();

  if (insertError || !category) {
    return NextResponse.json(
      { error: "No se pudo crear la categoría. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ category }, { status: 201 });
}

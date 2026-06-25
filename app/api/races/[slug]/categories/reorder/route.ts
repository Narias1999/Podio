import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import {
  validateReorderCategoriesPayload,
  type ReorderCategoriesPayload,
} from "@/lib/categories";

// POST /api/races/[slug]/categories/reorder — applies a new category order
// for a race owned by the session user. Body is
// `{ category_ids: string[] }` listing every category id of the race in the
// desired order; sort_order is recalculated as 0..N-1 to match (index 0
// starts first in TT start order — Story 05). Authenticates the session,
// confirms `races.organizer_id` matches, then writes with the service-role
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
  const race = await loadOwnedRace(admin, slug, user.id);

  if (!race) {
    return NextResponse.json(
      { error: "Carrera no encontrada." },
      { status: 404 },
    );
  }

  let payload: ReorderCategoriesPayload;
  try {
    payload = (await request.json()) as ReorderCategoriesPayload;
  } catch {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const { data: existingCategories, error: categoriesError } = await admin
    .from("categories")
    .select("id")
    .eq("race_id", race.id);

  if (categoriesError || !existingCategories) {
    return NextResponse.json(
      { error: "No se pudo reordenar las categorías. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const validationError = validateReorderCategoriesPayload(
    payload,
    existingCategories.map((c) => c.id),
  );
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  for (let i = 0; i < payload.category_ids.length; i += 1) {
    const { error: updateError } = await admin
      .from("categories")
      .update({ sort_order: i })
      .eq("id", payload.category_ids[i]);

    if (updateError) {
      return NextResponse.json(
        { error: "No se pudo reordenar las categorías. Inténtalo de nuevo." },
        { status: 500 },
      );
    }
  }

  const { data: categories, error: finalError } = await admin
    .from("categories")
    .select("*")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: true });

  if (finalError) {
    return NextResponse.json(
      { error: "No se pudo reordenar las categorías. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ categories });
}

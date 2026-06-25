import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { uniqueSlug } from "@/lib/slug";
import {
  type CreateRacePayload,
  validateCreateRacePayload,
} from "@/lib/race-wizard";
import type { StageType } from "@/types/app";

// POST /api/races — creates a race owned by the session user, along with its
// categories and (for single-stage races) an auto-generated first stage.
// Writes go through the service-role admin client AFTER authenticating the
// session; organizer_id is forced to the session user (never trusted from the
// client). RLS is off — see the authorization model in Story 01.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  let payload: CreateRacePayload;
  try {
    payload = (await request.json()) as CreateRacePayload;
  } catch {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const validationError = validateCreateRacePayload(payload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const admin = createAdminClient();

  // Resolve a unique slug against existing races.
  const { data: existing, error: slugLookupError } = await admin
    .from("races")
    .select("slug");
  if (slugLookupError) {
    return NextResponse.json(
      { error: "No se pudo crear la carrera. Inténtalo de nuevo." },
      { status: 500 },
    );
  }
  const slug = uniqueSlug(
    payload.name,
    (existing ?? []).map((r) => r.slug),
  );

  // Insert the race.
  const { data: race, error: raceError } = await admin
    .from("races")
    .insert({
      organizer_id: user.id,
      name: payload.name.trim(),
      slug,
      discipline: payload.discipline,
      location: payload.location.trim(),
      description: payload.description?.trim() || null,
      banner_url: payload.banner_url || null,
      status: payload.status,
      is_multi_stage: payload.is_multi_stage,
      starts_at: payload.starts_at,
      ends_at: payload.ends_at || null,
    })
    .select("id, slug")
    .single();

  if (raceError || !race) {
    return NextResponse.json(
      { error: "No se pudo crear la carrera. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  // Insert categories preserving the wizard order as sort_order.
  const categoryRows = payload.categories.map((cat, index) => ({
    race_id: race.id,
    name: cat.name.trim(),
    sort_order: index,
    age_min: cat.age_min,
    age_max: cat.age_max,
    sex: cat.sex,
  }));

  const { error: categoriesError } = await admin
    .from("categories")
    .insert(categoryRows);

  if (categoriesError) {
    // Roll back the race so we don't leave an orphan with no categories.
    await admin.from("races").delete().eq("id", race.id);
    return NextResponse.json(
      { error: "No se pudo crear la carrera. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  // Single-stage races get one stage auto-created (Story 04 edits it later).
  if (!payload.is_multi_stage) {
    const defaultStageType: StageType = "road";
    const { error: stageError } = await admin.from("stages").insert({
      race_id: race.id,
      stage_number: 1,
      name: "Etapa 1",
      date: payload.starts_at,
      stage_type: defaultStageType,
    });

    if (stageError) {
      await admin.from("races").delete().eq("id", race.id);
      return NextResponse.json(
        { error: "No se pudo crear la carrera. Inténtalo de nuevo." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ slug: race.slug }, { status: 201 });
}

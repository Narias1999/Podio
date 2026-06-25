import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import { planBibAssignments } from "@/lib/riders";
import type { Category } from "@/types/app";

// POST /api/races/[slug]/riders/close — closes registration for a race and
// assigns bibs. Each category (in sort_order) gets a contiguous range sized to
// its confirmed-rider count; bibs are randomised within each range. DNS riders
// keep a null bib. Sets `races.registrations_closed = true`. Authenticates the
// session, confirms `races.organizer_id` matches, then writes with the
// service-role client (RLS is off — Story 01).

export async function POST(
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

  const { data: categories, error: categoriesError } = await admin
    .from("categories")
    .select("*")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: true });

  if (categoriesError) {
    return NextResponse.json(
      { error: "No se pudo cerrar la inscripción. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const { data: registrations, error: registrationsError } = await admin
    .from("registrations")
    .select("id, category_id, status")
    .eq("race_id", race.id);

  if (registrationsError) {
    return NextResponse.json(
      { error: "No se pudo cerrar la inscripción. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const confirmed = (registrations ?? []).filter((r) => r.status === "confirmed");
  if (confirmed.length === 0) {
    return NextResponse.json(
      { error: "No hay corredores inscritos para asignar dorsales." },
      { status: 400 },
    );
  }

  const confirmedByCategory = new Map<string, string[]>();
  for (const reg of confirmed) {
    const list = confirmedByCategory.get(reg.category_id) ?? [];
    list.push(reg.id);
    confirmedByCategory.set(reg.category_id, list);
  }

  const { assignments, ranges } = planBibAssignments(
    (categories ?? []) as Category[],
    confirmedByCategory,
  );

  // Clear any existing bibs first so re-running close can't collide with the
  // per-race unique constraint, then write the new assignments.
  const { error: clearError } = await admin
    .from("registrations")
    .update({ bib_number: null })
    .eq("race_id", race.id);

  if (clearError) {
    return NextResponse.json(
      { error: "No se pudo cerrar la inscripción. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  for (const assignment of assignments) {
    const { error: assignError } = await admin
      .from("registrations")
      .update({ bib_number: assignment.bib_number })
      .eq("id", assignment.registration_id);
    if (assignError) {
      return NextResponse.json(
        { error: "No se pudo asignar los dorsales. Inténtalo de nuevo." },
        { status: 500 },
      );
    }
  }

  const { error: closeError } = await admin
    .from("races")
    .update({ registrations_closed: true })
    .eq("id", race.id);

  if (closeError) {
    return NextResponse.json(
      { error: "No se pudo cerrar la inscripción. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ranges, assignments });
}

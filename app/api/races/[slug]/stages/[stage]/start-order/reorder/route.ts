import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import {
  isStartOrderLocked,
  loadStartOrder,
  persistReorderedPositions,
  reorderWithinCategory,
} from "@/lib/tt-start-order";

// POST /api/races/[slug]/stages/[stage]/start-order/reorder — applies a
// manual within-category drag-to-reorder of the TT start order (Story 12).
// Body: `{ registration_id: string, to_index: number }`, where `to_index` is
// the rider's new 0-based index *within their own category's block*. Riders
// cannot be moved across categories — `registration_id`'s category is fixed,
// only its position within that category's run changes. Start times for the
// affected category are recalculated from its own first rider's anchor and
// inferred interval; other categories (and the gap to them) are untouched.
// Locked once the live session has started (any `stage_category_starts` row
// exists for the stage — written by Story 17). Authenticates the session,
// confirms `races.organizer_id` matches, then writes with the service-role
// client (RLS is off — Story 01).

async function loadOwnedStageByNumber(
  admin: ReturnType<typeof createAdminClient>,
  slug: string,
  stageNumber: number,
  userId: string,
) {
  const race = await loadOwnedRace(admin, slug, userId);
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

type ReorderPayload = {
  registration_id: string;
  to_index: number;
};

function isValidPayload(value: unknown): value is ReorderPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.registration_id === "string" &&
    payload.registration_id.length > 0 &&
    typeof payload.to_index === "number" &&
    Number.isInteger(payload.to_index) &&
    payload.to_index >= 0
  );
}

export async function POST(
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
  const { race, stage } = await loadOwnedStageByNumber(
    admin,
    slug,
    stageNumber,
    user.id,
  );
  if (!race || !stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  if (stage.stage_type !== "time_trial") {
    return NextResponse.json(
      { error: "El orden de salida solo aplica a etapas de contrarreloj." },
      { status: 400 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }
  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const locked = await isStartOrderLocked(admin, stage.id);
  if (locked) {
    return NextResponse.json(
      { error: "La etapa ya inició — el orden de salida está bloqueado." },
      { status: 409 },
    );
  }

  const entries = await loadStartOrder(admin, stage.id);
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Aún no se ha generado el orden de salida." },
      { status: 400 },
    );
  }

  const result = reorderWithinCategory(
    entries,
    payload.registration_id,
    payload.to_index,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const saved = await persistReorderedPositions(admin, result.entries);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    entries: result.entries
      .sort((a, b) => a.position - b.position)
      .map((e) => ({
        position: e.position,
        start_time: e.start_time,
        bib_number: e.bib_number,
        rider_name: e.rider_name,
        team: e.team,
        category_name: e.category_name,
        registration_id: e.registration_id,
        category_id: e.category_id,
      })),
  });
}

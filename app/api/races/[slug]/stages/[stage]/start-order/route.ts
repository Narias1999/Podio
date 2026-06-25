import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import type { GcResult, GcStage } from "@/lib/gc";
import {
  computeStartOrder,
  replaceStartOrder,
  validateStartOrderConfig,
  type StartOrderConfig,
  type StartOrderRider,
} from "@/lib/tt-start-order";

// POST /api/races/[slug]/stages/[stage]/start-order — generates (or
// regenerates) the TT start order for a stage (Story 11). Blocked unless the
// stage is a time trial and registration is closed (bibs assigned). Opening
// TTs use random within-category order; mid-race TTs use inverse GC computed
// from prior completed (locked) stages. Authenticates the session, confirms
// `races.organizer_id` matches, then writes with the service-role client
// (RLS is off — Story 01).

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

  // Confirm registration is closed and bibs are assigned (Story 11 / 06).
  const { data: raceRow } = await admin
    .from("races")
    .select("registrations_closed")
    .eq("id", race.id)
    .maybeSingle();
  if (!raceRow?.registrations_closed) {
    return NextResponse.json(
      {
        error:
          "Cierra la inscripción y asigna los dorsales antes de generar el orden de salida.",
      },
      { status: 409 },
    );
  }

  let payload: StartOrderConfig;
  try {
    payload = (await request.json()) as StartOrderConfig;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const configError = validateStartOrderConfig(payload);
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 400 });
  }

  // Registrations for the race, with rider + category info.
  const { data: registrationRows, error: regError } = await admin
    .from("registrations")
    .select(
      "id, bib_number, status, category_id, categories(id, name, sort_order), riders(name, team)",
    )
    .eq("race_id", race.id);

  if (regError) {
    return NextResponse.json(
      { error: "No se pudieron cargar los corredores." },
      { status: 500 },
    );
  }

  const riders: StartOrderRider[] = (registrationRows ?? [])
    .filter((r) => r.categories && r.riders)
    .map((r) => {
      const category = r.categories as unknown as {
        id: string;
        name: string;
        sort_order: number;
      };
      const rider = r.riders as unknown as { name: string; team: string | null };
      return {
        registration_id: r.id,
        bib_number: r.bib_number,
        rider_name: rider.name,
        team: rider.team,
        category_id: category.id,
        category_name: category.name,
        category_sort_order: category.sort_order,
        registration_status: r.status as "confirmed" | "dns",
      };
    });

  if (riders.length === 0) {
    return NextResponse.json(
      { error: "No hay corredores inscritos para esta etapa." },
      { status: 400 },
    );
  }

  // Prior completed (results_locked) stages, for the mid-race inverse-GC rule.
  const { data: stageRows } = await admin
    .from("stages")
    .select("id, stage_number, results_locked")
    .eq("race_id", race.id)
    .lt("stage_number", stageNumber)
    .eq("results_locked", true);

  const priorStages: GcStage[] = (stageRows ?? []).map((s) => ({
    id: s.id,
    stage_number: s.stage_number,
  }));

  let priorResults: GcResult[] = [];
  if (priorStages.length > 0) {
    const { data: resultRows } = await admin
      .from("results")
      .select("stage_id, registration_id, status, net_seconds, position")
      .in(
        "stage_id",
        priorStages.map((s) => s.id),
      );
    priorResults = (resultRows ?? []) as GcResult[];
  }

  const plan = computeStartOrder(
    riders,
    stageNumber,
    stage.date,
    payload,
    priorStages,
    priorResults,
  );

  if (plan.entries.length === 0) {
    return NextResponse.json(
      {
        error:
          "No hay corredores elegibles para el orden de salida (revisa inscripciones y la clasificación general).",
      },
      { status: 400 },
    );
  }

  const saved = await replaceStartOrder(admin, stage.id, plan.entries);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({ count: plan.entries.length, usedGc: plan.usedGc });
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { requireProfile } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GroupStartLineView,
  type GroupStartLineCategory,
  type Wave as InitialWave,
} from "@/components/group-start-line-view";

export const metadata: Metadata = {
  title: "Salida — Etapa por Grupos — Podio",
};

/**
 * Group/road-stage start-line view (Story 20). Organizer-only live screen for
 * the start gate. Fetches the race, stage, all race categories, and any
 * existing `stage_category_starts` rows so an already-started session resumes
 * with the correct locked state. Authorization follows the no-RLS model (Story
 * 01): authenticate → verify the caller's organization → read with
 * service-role client.
 */
export default async function GroupStartLinePage({
  params,
}: {
  params: Promise<{ slug: string; stage: string }>;
}) {
  const { slug, stage: stageParam } = await params;
  const stageNumber = Number.parseInt(stageParam, 10);
  const { organization_id } = await requireProfile();

  if (!Number.isInteger(stageNumber)) {
    notFound();
  }

  const admin = createAdminClient();

  const { data: race } = await admin
    .from("races")
    .select("id, name, organization_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organization_id !== organization_id) {
    notFound();
  }

  const { data: stage } = await admin
    .from("stages")
    .select("id, name, date, stage_type")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  // Only non-TT stage types use this view.
  if (!stage || stage.stage_type === "time_trial") {
    notFound();
  }

  // All categories for this race (sorted by sort_order for display).
  const { data: categories } = await admin
    .from("categories")
    .select("id, name, sort_order")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: true });

  // Existing starts — used to restore locked state and the wave log on resume.
  const { data: existingStarts } = await admin
    .from("stage_category_starts")
    .select("category_id, started_at")
    .eq("stage_id", stage.id)
    .order("started_at", { ascending: true });

  const alreadyStartedCategoryIds = (existingStarts ?? []).map(
    (row) => row.category_id,
  );

  const categoryList: GroupStartLineCategory[] = (categories ?? []).map(
    (c) => ({
      id: c.id,
      name: c.name,
      sort_order: c.sort_order,
    }),
  );

  // Group existing starts into waves by their shared `started_at` instant
  // (rows with the same ISO timestamp = one wave), ordered chronologically.
  const categoriesById = new Map(categoryList.map((c) => [c.id, c]));
  const wavesByStartedAt = new Map<string, GroupStartLineCategory[]>();
  for (const row of existingStarts ?? []) {
    const category = categoriesById.get(row.category_id);
    if (!category) continue;
    const bucket = wavesByStartedAt.get(row.started_at);
    if (bucket) {
      bucket.push(category);
    } else {
      wavesByStartedAt.set(row.started_at, [category]);
    }
  }
  const initialWaves: InitialWave[] = [...wavesByStartedAt.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startedAt, waveCategories]) => ({ startedAt, categories: waveCategories }));

  const stageDateLabel = formatStageDate(stage.date);

  return (
    <GroupStartLineView
      slug={slug}
      stageNumber={stageNumber}
      stageId={stage.id}
      stageName={stage.name}
      stageDateLabel={stageDateLabel}
      categories={categoryList}
      alreadyStartedCategoryIds={alreadyStartedCategoryIds}
      initialWaves={initialWaves}
    />
  );
}

function formatStageDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GroupStartLineView,
  type GroupStartLineCategory,
} from "@/components/group-start-line-view";

export const metadata: Metadata = {
  title: "Salida — Etapa por Grupos — Podio",
};

/**
 * Group/road-stage start-line view (Story 20). Organizer-only live screen for
 * the start gate. Fetches the race, stage, all race categories, and any
 * existing `stage_category_starts` rows so an already-started session resumes
 * with the correct locked state. Authorization follows the no-RLS model (Story
 * 01): authenticate → verify ownership → read with service-role client.
 */
export default async function GroupStartLinePage({
  params,
}: {
  params: Promise<{ slug: string; stage: string }>;
}) {
  const { slug, stage: stageParam } = await params;
  const stageNumber = Number.parseInt(stageParam, 10);
  const user = await requireUser();

  if (!Number.isInteger(stageNumber)) {
    notFound();
  }

  const admin = createAdminClient();

  const { data: race } = await admin
    .from("races")
    .select("id, name, organizer_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organizer_id !== user.id) {
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

  // Existing starts — used to restore locked state on resume.
  const { data: existingStarts } = await admin
    .from("stage_category_starts")
    .select("category_id")
    .eq("stage_id", stage.id);

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
    />
  );
}

function formatStageDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
}

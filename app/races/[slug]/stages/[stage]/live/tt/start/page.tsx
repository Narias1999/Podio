import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { requireProfile } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStartOrder } from "@/lib/tt-start-order";
import {
  TtStartLineView,
  type TtStartLineRider,
} from "@/components/tt-start-line-view";

export const metadata: Metadata = {
  title: "Salida — Contrarreloj — Podio",
};

/**
 * TT start-line view (Story 17). Organizer-only live screen for the start gate.
 * Server-fetches the stage/race, the generated start order (riders + planned
 * times), and any existing `stage_category_starts` rows so an already-started
 * session resumes straight into the live countdown. The `/live` route is
 * already auth-gated in `lib/supabase/middleware.ts`; we re-check the caller's
 * organization here (RLS is off — Story 01 authorization model).
 */
export default async function TtStartLinePage({
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

  if (!stage || stage.stage_type !== "time_trial") {
    notFound();
  }

  const entries = await loadStartOrder(admin, stage.id);
  const riders: TtStartLineRider[] = entries.map((e) => ({
    registration_id: e.registration_id,
    position: e.position,
    start_time: e.start_time,
    bib_number: e.bib_number,
    rider_name: e.rider_name,
    category_id: e.category_id,
    category_name: e.category_name,
  }));

  // Resume an already-started session: any row means Start was already pressed.
  const { data: existingStarts } = await admin
    .from("stage_category_starts")
    .select("started_at")
    .eq("stage_id", stage.id)
    .order("started_at", { ascending: true })
    .limit(1);
  const initialAnchor = existingStarts?.[0]?.started_at ?? null;

  // Derive the planned config summary for the pre-start screen from the start
  // order's own planned times (interval/gap aren't stored separately — same
  // approach as the public start list, Story 13).
  const firstStartLabel = formatFirstStartTime(riders);
  const intervalSeconds = inferIntervalSeconds(riders);
  const categoryGapSeconds = inferCategoryGapSeconds(riders, intervalSeconds);
  const stageDateLabel = formatStageDate(stage.date);

  return (
    <TtStartLineView
      slug={slug}
      stageNumber={stageNumber}
      stageId={stage.id}
      stageName={stage.name}
      stageDateLabel={stageDateLabel}
      firstStartLabel={firstStartLabel}
      intervalSeconds={intervalSeconds}
      categoryGapSeconds={categoryGapSeconds}
      riders={riders}
      initialAnchor={initialAnchor}
    />
  );
}

function formatStageDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
}

function formatFirstStartTime(riders: TtStartLineRider[]): string | null {
  const byPosition = [...riders].sort((a, b) => a.position - b.position);
  const first = byPosition.find((r) => r.start_time !== null);
  if (!first?.start_time) return null;
  const parsed = new Date(first.start_time);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, "HH:mm:ss", { locale: es });
}

/** Interval (s) between the first two riders of the first category block. */
function inferIntervalSeconds(riders: TtStartLineRider[]): number | null {
  const byPosition = [...riders].sort((a, b) => a.position - b.position);
  const firstCategoryId = byPosition[0]?.category_id;
  const firstCategoryRows = byPosition.filter(
    (r) => r.category_id === firstCategoryId,
  );
  for (let i = 1; i < firstCategoryRows.length; i++) {
    const delta = secondsBetween(
      firstCategoryRows[i - 1].start_time,
      firstCategoryRows[i].start_time,
    );
    if (delta != null && delta > 0) return delta;
  }
  return null;
}

/**
 * Extra gap (s) between categories: the jump at the first category boundary
 * minus the per-rider interval. Returns null when there's no second category
 * or the interval is unknown.
 */
function inferCategoryGapSeconds(
  riders: TtStartLineRider[],
  intervalSeconds: number | null,
): number | null {
  if (intervalSeconds == null) return null;
  const byPosition = [...riders].sort((a, b) => a.position - b.position);
  for (let i = 1; i < byPosition.length; i++) {
    if (byPosition[i].category_id !== byPosition[i - 1].category_id) {
      const delta = secondsBetween(
        byPosition[i - 1].start_time,
        byPosition[i].start_time,
      );
      if (delta == null) return null;
      const gap = delta - intervalSeconds;
      return gap > 0 ? gap : 0;
    }
  }
  return null;
}

function secondsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const aMs = new Date(a).getTime();
  const bMs = new Date(b).getTime();
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return null;
  return Math.round((bMs - aMs) / 1000);
}

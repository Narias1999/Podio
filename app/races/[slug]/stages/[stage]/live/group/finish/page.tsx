import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  GroupFinishLineView,
  type GroupFinishRider,
} from "@/components/group-finish-line-view";

export const metadata: Metadata = {
  title: "Llegada — Etapa por Grupos — Podio",
};

/**
 * Group/road-stage finish-line view (Story 21). Organizer-only live screen for
 * the finish gate. Server-fetches:
 *   - the race + stage (non-TT only),
 *   - every registration (bib → rider/category) for bib validation,
 *   - existing `stage_category_starts` (resume an already-started session +
 *     per-category `started_at` so the elapsed timer anchors to the earliest
 *     wave),
 *   - the bibs that already have a saved result (so cross-group duplicate
 *     detection survives a refresh).
 *
 * The `/live` route is auth-gated in middleware; ownership is re-checked here
 * (RLS is off — Story 01).
 */
export default async function GroupFinishLinePage({
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
    .select("id, name, stage_type, results_locked")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  // Only non-TT stage types use this view.
  if (!stage || stage.stage_type === "time_trial") {
    notFound();
  }

  // All registrations for the race (bib → rider/category) for bib validation.
  const { data: registrations } = await admin
    .from("registrations")
    .select(
      "id, bib_number, category_id, riders(name), categories(name)",
    )
    .eq("race_id", race.id);

  const riders: GroupFinishRider[] = (registrations ?? [])
    .filter((r) => r.bib_number !== null)
    .map((r) => {
      const rider = r.riders as unknown as { name: string } | null;
      const category = r.categories as unknown as { name: string } | null;
      return {
        registration_id: r.id,
        bib_number: r.bib_number as number,
        category_id: r.category_id,
        rider_name: rider?.name ?? "—",
        category_name: category?.name ?? "—",
      };
    });

  // Earliest wave start anchors the on-screen elapsed timer and lets an
  // already-started session resume straight to the live state. Net time per
  // rider is computed server-side against that rider's own category wave start.
  const { data: existingStarts } = await admin
    .from("stage_category_starts")
    .select("started_at")
    .eq("stage_id", stage.id)
    .order("started_at", { ascending: true })
    .limit(1);

  const initialAnchor = existingStarts?.[0]?.started_at ?? null;

  // Bibs that already have a saved result — used for cross-group duplicate
  // detection after a refresh (operator gets the warning chip instead of a
  // silent duplicate).
  const registrationIds = (registrations ?? []).map((r) => r.id);
  let savedBibs: number[] = [];
  if (registrationIds.length > 0) {
    const { data: results } = await admin
      .from("results")
      .select("registration_id")
      .eq("stage_id", stage.id)
      .in("registration_id", registrationIds);
    const savedRegistrationIds = new Set(
      (results ?? []).map((r) => r.registration_id),
    );
    savedBibs = riders
      .filter((r) => savedRegistrationIds.has(r.registration_id))
      .map((r) => r.bib_number);
  }

  return (
    <GroupFinishLineView
      slug={slug}
      stageNumber={stageNumber}
      stageId={stage.id}
      stageName={stage.name}
      resultsLocked={stage.results_locked}
      riders={riders}
      initialAnchor={initialAnchor}
      initialSavedBibs={savedBibs}
    />
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireProfile } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStartOrder } from "@/lib/tt-start-order";
import {
  TtFinishLineView,
  type TtFinishLineRider,
} from "@/components/tt-finish-line-view";

export const metadata: Metadata = {
  title: "Llegada — Contrarreloj — Podio",
};

/**
 * TT finish-line view (Story 18). Organizer-only live screen for the finish
 * gate. Server-fetches the stage/race, the generated start order (riders +
 * planned times, for bib validation and re-anchored scheduled departures), the
 * session anchor (`stage_category_starts`) so an already-started session goes
 * straight to live, and the bibs that already have a saved result (so a refresh
 * knows which assignments are duplicates). The `/live` route is auth-gated in
 * middleware; the caller's organization is re-checked here (RLS is off — Story 01).
 */
export default async function TtFinishLinePage({
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
    .select("id, name, stage_type, results_locked")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  if (!stage || stage.stage_type !== "time_trial") {
    notFound();
  }

  const entries = await loadStartOrder(admin, stage.id);
  const riders: TtFinishLineRider[] = entries.map((e) => ({
    registration_id: e.registration_id,
    position: e.position,
    start_time: e.start_time,
    bib_number: e.bib_number,
    rider_name: e.rider_name,
    category_id: e.category_id,
    category_name: e.category_name,
  }));

  // Resume an already-started session: earliest `started_at` is the anchor.
  const { data: existingStarts } = await admin
    .from("stage_category_starts")
    .select("started_at")
    .eq("stage_id", stage.id)
    .order("started_at", { ascending: true })
    .limit(1);
  const initialAnchor = existingStarts?.[0]?.started_at ?? null;

  // Bibs that already have a saved result — used to detect duplicates after a
  // refresh (the operator gets the overwrite warning instead of a silent dup).
  const registrationIds = entries.map((e) => e.registration_id);
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
    savedBibs = entries
      .filter(
        (e) =>
          e.bib_number !== null && savedRegistrationIds.has(e.registration_id),
      )
      .map((e) => e.bib_number as number);
  }

  return (
    <TtFinishLineView
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

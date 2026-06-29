import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { requireProfile } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { ResultsManager, type ResultRow } from "@/components/results-manager";
import { formatSecondsToTime } from "@/lib/results";
import type { Result, ResultStatus } from "@/types/app";

export const metadata: Metadata = {
  title: "Resultados — Podio",
};

export default async function StageResultsPage({
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

  // Organizer read scoped to the caller's organization. Service-role client +
  // explicit organization_id check (RLS is off — Story 01 authorization model).
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
    .select("*")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  if (!stage) {
    notFound();
  }

  const { data: registrations } = await admin
    .from("registrations")
    .select(
      "id, bib_number, status, category_id, categories(id, name, sort_order), riders(id, name)",
    )
    .eq("race_id", race.id);

  const registrationIds = (registrations ?? []).map((r) => r.id);
  let results: Result[] = [];
  if (registrationIds.length > 0) {
    const { data: resultRows } = await admin
      .from("results")
      .select("*")
      .eq("stage_id", stage.id)
      .in("registration_id", registrationIds);
    results = (resultRows ?? []) as Result[];
  }
  const resultByRegistration = new Map(results.map((r) => [r.registration_id, r]));

  const rows: ResultRow[] = (registrations ?? [])
    .filter((r) => r.categories && r.riders)
    .map((r) => {
      const category = r.categories as unknown as {
        id: string;
        name: string;
        sort_order: number;
      };
      const rider = r.riders as unknown as { id: string; name: string };
      const result = resultByRegistration.get(r.id);
      const isDns = r.status === "dns";
      const status: ResultStatus = isDns
        ? "dns"
        : (result?.status as ResultStatus | undefined) ?? "finished";

      // Story 22: a group-stage finish saved without a net time (the rider's
      // category never recorded a start) is a `finished` row with null
      // `net_seconds`. Flag it so the screen warns the organizer.
      const missingStart =
        !isDns &&
        result?.status === "finished" &&
        result.net_seconds == null;

      return {
        registration_id: r.id,
        bib_number: r.bib_number,
        rider_name: rider.name,
        category_id: category.id,
        category_name: category.name,
        category_sort_order: category.sort_order,
        registration_status: r.status as "confirmed" | "dns",
        status,
        finish_time:
          !isDns && result?.status === "finished" && result.net_seconds != null
            ? formatSecondsToTime(result.net_seconds)
            : "",
        position:
          !isDns && result?.status === "finished" && result.position != null
            ? String(result.position)
            : "",
        dnf_reason: !isDns && result?.dnf_reason ? result.dnf_reason : "",
        dsq_reason: !isDns && result?.dsq_reason ? result.dsq_reason : "",
        saved: isDns ? false : result != null,
        missingStart,
      };
    });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 md:py-10">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline">
          <Link href={`/races/${slug}/manage`}>← Gestionar carrera</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          Resultados — {stage.name}
        </h1>
        <p className="text-muted-foreground">{race.name}</p>
      </div>

      <ResultsManager
        slug={slug}
        stageNumber={stageNumber}
        initialRows={rows}
        initialLocked={stage.results_locked}
      />
    </main>
  );
}

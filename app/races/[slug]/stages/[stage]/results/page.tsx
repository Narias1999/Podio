import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { PublicStageResults } from "@/components/public-stage-results";
import { STAGE_TYPE_LABELS } from "@/lib/stage-types";
import {
  buildStageResults,
  type PublicResultRegistration,
  type PublicResultRow,
} from "@/lib/public-results";
import type { StageType } from "@/types/app";

export const metadata: Metadata = {
  title: "Resultados de la etapa — Podio",
};

export default async function PublicStageResultsPage({
  params,
}: {
  params: Promise<{ slug: string; stage: string }>;
}) {
  const { slug, stage: stageParam } = await params;
  const stageNumber = Number.parseInt(stageParam, 10);

  if (!Number.isInteger(stageNumber)) {
    notFound();
  }

  // Public read: service-role client + explicit visibility filter. Only
  // published/completed races are accessible; draft → 404 (RLS is off, so this
  // guard is the only protection — Story 01 authorization model).
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("id, name, status")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || (race.status !== "published" && race.status !== "completed")) {
    notFound();
  }

  const { data: stage } = await admin
    .from("stages")
    .select("id, name, date, stage_type, distance_km, results_locked")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  if (!stage) {
    notFound();
  }

  const { data: registrationRows } = await admin
    .from("registrations")
    .select(
      "id, bib_number, status, category_id, categories(id, name, sort_order), riders(name, team)",
    )
    .eq("race_id", race.id);

  const registrations: PublicResultRegistration[] = (registrationRows ?? [])
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

  const registrationIds = registrations.map((r) => r.registration_id);
  let results: PublicResultRow[] = [];
  if (registrationIds.length > 0) {
    const { data: resultRows } = await admin
      .from("results")
      .select("registration_id, status, net_seconds, position")
      .eq("stage_id", stage.id)
      .in("registration_id", registrationIds);
    results = (resultRows ?? []) as PublicResultRow[];
  }

  const standings = buildStageResults(registrations, results);

  // A stage is "live" when a category has started (a stage_category_starts row
  // exists) but the stage hasn't been locked/completed yet.
  let isLive = false;
  if (!stage.results_locked) {
    const { count } = await admin
      .from("stage_category_starts")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stage.id);
    isLive = (count ?? 0) > 0;
  }

  const stageType = stage.stage_type as StageType;
  const isTimeTrial = stageType === "time_trial";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 md:py-10">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline">
          <Link href={`/races/${slug}/results`}>← Resultados de la carrera</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{stage.name}</h1>
        <p className="text-muted-foreground">{race.name}</p>
        <p className="text-sm text-muted-foreground">
          {STAGE_TYPE_LABELS[stageType]} · {formatStageDate(stage.date)}
          {stage.distance_km != null ? ` · ${stage.distance_km} km` : ""}
        </p>
      </div>

      {!standings.hasAnyResult ? (
        <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Los resultados de esta etapa aún no se han publicado.
        </p>
      ) : (
        <PublicStageResults
          stageId={stage.id}
          isTimeTrial={isTimeTrial}
          isLive={isLive}
          results={standings}
        />
      )}
    </main>
  );
}

function formatStageDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
}

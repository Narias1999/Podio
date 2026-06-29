import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GcStandingsTable } from "@/components/gc-standings-table";
import { DISCIPLINE_LABELS } from "@/lib/race-status";
import { STAGE_TYPE_LABELS, STAGE_STATUS_LABELS } from "@/lib/stage-types";
import {
  computeGc,
  type GcRegistration,
  type GcResult,
  type GcStage,
} from "@/lib/gc";
import type { Discipline, StageType } from "@/types/app";

export const metadata: Metadata = {
  title: "Resultados — Podio",
};

type StageDisplayStatus = "upcoming" | "live" | "completed";

export default async function PublicRaceResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Public read: service-role client + explicit visibility filter. Only
  // published/completed races are accessible; draft → 404 (RLS is off, so this
  // guard is the only protection — Story 01 authorization model).
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select(
      "id, name, status, discipline, location, starts_at, ends_at, banner_url, is_multi_stage",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!race || (race.status !== "published" && race.status !== "completed")) {
    notFound();
  }

  const { data: stages } = await admin
    .from("stages")
    .select("id, name, stage_number, stage_type, date, results_locked")
    .eq("race_id", race.id)
    .order("stage_number", { ascending: true });

  const stageList = stages ?? [];
  const stageIds = stageList.map((s) => s.id);

  // Which stages have an active live session (a stage_category_starts row,
  // i.e. at least one category has started but the stage isn't completed).
  const liveStageIds = new Set<string>();
  if (stageIds.length > 0) {
    const { data: startRows } = await admin
      .from("stage_category_starts")
      .select("stage_id")
      .in("stage_id", stageIds);
    for (const row of startRows ?? []) liveStageIds.add(row.stage_id);
  }

  const stagesWithStatus = stageList.map((s) => {
    let status: StageDisplayStatus;
    if (s.results_locked) {
      status = "completed";
    } else if (liveStageIds.has(s.id)) {
      status = "live";
    } else {
      status = "upcoming";
    }
    return { ...s, status };
  });

  const hasCompletedStages = stagesWithStatus.some(
    (s) => s.status === "completed",
  );

  // GC standings (Story 10) — only for multi-stage races. Computed on read from
  // the completed (results_locked) stages so it always reflects current results.
  let gcStandings: ReturnType<typeof computeGc> | null = null;
  if (race.is_multi_stage) {
    const completedStages: GcStage[] = stageList
      .filter((s) => s.results_locked)
      .map((s) => ({ id: s.id, stage_number: s.stage_number }));

    const { data: gcRegistrationRows } = await admin
      .from("registrations")
      .select(
        "id, bib_number, status, category_id, categories(id, name, sort_order), riders(name, team)",
      )
      .eq("race_id", race.id);

    const gcRegistrations: GcRegistration[] = (gcRegistrationRows ?? [])
      .filter((r) => r.categories && r.riders)
      .map((r) => {
        const category = r.categories as unknown as {
          id: string;
          name: string;
          sort_order: number;
        };
        const rider = r.riders as unknown as {
          name: string;
          team: string | null;
        };
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

    let gcResults: GcResult[] = [];
    const completedStageIds = completedStages.map((s) => s.id);
    if (completedStageIds.length > 0) {
      const { data: resultRows } = await admin
        .from("results")
        .select("stage_id, registration_id, status, net_seconds, position")
        .in("stage_id", completedStageIds);
      gcResults = (resultRows ?? []) as GcResult[];
    }

    gcStandings = computeGc(completedStages, gcRegistrations, gcResults);
  }

  const stageSection = (
    <Card>
      <CardHeader>
        <CardTitle>Etapas</CardTitle>
        <CardDescription>
          Consulta los resultados de cada etapa finalizada.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stagesWithStatus.length === 0 ? (
          <p className="text-center text-muted-foreground">
            Aún no hay etapas para esta carrera.
          </p>
        ) : !hasCompletedStages ? (
          <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
            Aún no hay resultados disponibles. Vuelve a consultar después de la
            carrera.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {stagesWithStatus.map((s) => {
              const row = (
                <div className="flex items-center justify-between gap-3 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {STAGE_TYPE_LABELS[s.stage_type as StageType]} ·{" "}
                      {formatStageDate(s.date)}
                    </span>
                  </div>
                  <StageStatusBadge status={s.status} />
                </div>
              );
              return (
                <li key={s.id}>
                  {s.status === "completed" ? (
                    <Link
                      href={`/races/${slug}/stages/${s.stage_number}/results`}
                      className="block rounded-md px-2 transition-colors hover:bg-muted"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="px-2">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-4 md:py-10">
      {race.banner_url && (
        <div className="relative aspect-[3/1] w-full overflow-hidden rounded-lg">
          <Image
            src={race.banner_url}
            alt={race.name}
            fill
            className="object-cover"
            sizes="(max-width: 896px) 100vw, 896px"
            priority
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{race.name}</h1>
        <p className="text-muted-foreground">
          {DISCIPLINE_LABELS[race.discipline as Discipline]} · {race.location} ·{" "}
          {formatRaceDates(race.starts_at, race.ends_at)}
        </p>
      </div>

      {gcStandings ? (
        <Tabs defaultValue="stages">
          <TabsList>
            <TabsTrigger value="stages">Etapas</TabsTrigger>
            <TabsTrigger value="gc">Clasificación general</TabsTrigger>
          </TabsList>
          <TabsContent value="stages">{stageSection}</TabsContent>
          <TabsContent value="gc">
            <Card>
              <CardHeader>
                <CardTitle>Clasificación general</CardTitle>
                <CardDescription>
                  {gcStandings.stages.length === 0
                    ? "La clasificación general aparecerá cuando se complete al menos una etapa."
                    : `Suma acumulada de tiempos en ${gcStandings.stages.length} ${
                        gcStandings.stages.length === 1
                          ? "etapa completada"
                          : "etapas completadas"
                      }.`}
                </CardDescription>
              </CardHeader>
              {gcStandings.stages.length > 0 && (
                <CardContent>
                  <GcStandingsTable standings={gcStandings} />
                </CardContent>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        stageSection
      )}
    </main>
  );
}

function StageStatusBadge({ status }: { status: StageDisplayStatus }) {
  if (status === "live") {
    return (
      <Badge className="bg-red-600 text-white hover:bg-red-600">
        {STAGE_STATUS_LABELS.live}
      </Badge>
    );
  }
  return (
    <Badge variant={status === "completed" ? "default" : "secondary"}>
      {STAGE_STATUS_LABELS[status]}
    </Badge>
  );
}

function formatStageDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, "d 'de' MMMM 'de' yyyy", { locale: es });
}

function formatRaceDates(startsAt: string, endsAt: string | null): string {
  // `starts_at` / `ends_at` are date-only (yyyy-MM-dd) strings. Parse them at
  // local midnight; `new Date("yyyy-MM-dd")` would parse as UTC and shift the
  // displayed day back one in negative-offset zones (e.g. es-CO, UTC-5).
  const start = new Date(`${startsAt}T00:00:00`);
  if (Number.isNaN(start.getTime())) return "";
  const startLabel = format(start, "d 'de' MMMM 'de' yyyy", { locale: es });
  if (!endsAt) return startLabel;
  const end = new Date(`${endsAt}T00:00:00`);
  if (Number.isNaN(end.getTime())) return startLabel;
  if (start.toDateString() === end.toDateString()) return startLabel;
  return `${format(start, "d 'de' MMMM", { locale: es })} – ${format(
    end,
    "d 'de' MMMM 'de' yyyy",
    { locale: es },
  )}`;
}

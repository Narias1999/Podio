import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { requireProfile } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RACE_STATUS_LABELS } from "@/lib/race-status";
import { StagesManager } from "@/components/stages-manager";
import { CategoriesManager } from "@/components/categories-manager";
import { CopyResultsLinkButton } from "@/components/copy-results-link-button";
import { GcStandings } from "@/components/gc-standings";
import {
  computeGc,
  type GcRegistration,
  type GcResult,
  type GcStage,
} from "@/lib/gc";
import type { RaceStatus } from "@/types/app";

export const metadata: Metadata = {
  title: "Gestionar carrera — Podio",
};

export default async function ManageRacePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { organization_id } = await requireProfile();

  // Organizer read scoped to the caller's organization. Service-role client +
  // explicit organization_id filter (RLS is off — Story 01 authorization model).
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("id, name, status, organization_id, is_multi_stage")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organization_id !== organization_id) {
    notFound();
  }

  const status = race.status as RaceStatus;

  // Stages section (Story 04). Organizer read scoped to the caller's
  // organization via the check above; service-role client (RLS is off — Story 01).
  const { data: stages } = await admin
    .from("stages")
    .select("*")
    .eq("race_id", race.id)
    .order("stage_number", { ascending: true });

  const stageIds = (stages ?? []).map((s) => s.id);
  let stagesWithResultsList: string[] = [];
  if (stageIds.length > 0) {
    const { data: resultRows } = await admin
      .from("results")
      .select("stage_id")
      .in("stage_id", stageIds);
    stagesWithResultsList = (resultRows ?? []).map((r) => r.stage_id);
  }

  // Categories section (Story 05). Organizer read scoped to the caller's
  // organization via the check above; service-role client (RLS is off — Story 01).
  const { data: categories } = await admin
    .from("categories")
    .select("*")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: true });

  const categoryIds = (categories ?? []).map((c) => c.id);
  const categoriesWithRegistrations = new Map<string, number>();
  if (categoryIds.length > 0) {
    const { data: registrationRows } = await admin
      .from("registrations")
      .select("category_id")
      .in("category_id", categoryIds);
    for (const row of registrationRows ?? []) {
      categoriesWithRegistrations.set(
        row.category_id,
        (categoriesWithRegistrations.get(row.category_id) ?? 0) + 1,
      );
    }
  }

  // GC standings (Story 10) — only for multi-stage races. Computed on read
  // (pure `computeGc`) from the completed stages so it always reflects the
  // current results with no separate persistence to keep in sync.
  let gcStandings: ReturnType<typeof computeGc> | null = null;
  if (race.is_multi_stage) {
    const completedStages: GcStage[] = (stages ?? [])
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

  const managementSections = (
    <>
      <StagesManager
        slug={slug}
        initialStages={stages ?? []}
        isMultiStage={race.is_multi_stage}
        stagesWithResults={new Set(stagesWithResultsList)}
      />

      <CategoriesManager
        slug={slug}
        initialCategories={categories ?? []}
        categoriesWithRegistrations={categoriesWithRegistrations}
      />
    </>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 md:py-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="outline">
          <Link href="/dashboard">← Panel</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {(status === "published" || status === "completed") && (
            <CopyResultsLinkButton slug={slug} />
          )}
          <Button asChild variant="outline">
            <Link href={`/races/${slug}/manage/riders`}>Corredores</Link>
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{race.name}</h1>
          <Badge variant={status === "published" ? "default" : "secondary"}>
            {RACE_STATUS_LABELS[status]}
          </Badge>
        </div>
        <p className="text-muted-foreground">
          La gestión de inscripciones y resultados se habilitará en los
          próximos pasos.
        </p>
      </div>

      {gcStandings ? (
        <Tabs defaultValue="management">
          <TabsList>
            <TabsTrigger value="management">Gestión</TabsTrigger>
            <TabsTrigger value="gc">Clasificación general</TabsTrigger>
          </TabsList>
          <TabsContent value="management" className="flex flex-col gap-6">
            {managementSections}
          </TabsContent>
          <TabsContent value="gc">
            <GcStandings standings={gcStandings} />
          </TabsContent>
        </Tabs>
      ) : (
        managementSections
      )}
    </main>
  );
}

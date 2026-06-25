import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadStartOrder } from "@/lib/tt-start-order";
import {
  StartListView,
  type StartListRow,
} from "@/components/start-list-view";

/**
 * Public start list page (Story 13). No auth — already whitelisted in
 * `lib/supabase/middleware.ts`. Draft races 404 (no RLS, so the visibility
 * filter is explicit here rather than left to the database).
 */
export const metadata: Metadata = {
  title: "Orden de salida — Podio",
};

export default async function PublicStartListPage({
  params,
}: {
  params: Promise<{ slug: string; stage: string }>;
}) {
  const { slug, stage: stageParam } = await params;
  const stageNumber = Number.parseInt(stageParam, 10);

  if (!Number.isInteger(stageNumber)) {
    notFound();
  }

  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("id, name, status")
    .eq("slug", slug)
    .maybeSingle();

  // Public read: only published/completed races are visible. Draft races
  // 404 rather than leaking existence — RLS is off, so this check is the
  // only guard (Story 01 authorization model).
  if (!race || (race.status !== "published" && race.status !== "completed")) {
    notFound();
  }

  const { data: stage } = await admin
    .from("stages")
    .select("id, name, date, stage_type")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  if (!stage) {
    notFound();
  }

  const entries = await loadStartOrder(admin, stage.id);
  const rows: StartListRow[] = entries.map((e) => ({
    registration_id: e.registration_id,
    position: e.position,
    start_time: e.start_time,
    bib_number: e.bib_number,
    rider_name: e.rider_name,
    team: e.team,
    category_id: e.category_id,
    category_name: e.category_name,
    category_sort_order: e.category_sort_order,
  }));

  // Interval isn't stored separately — derive it from the gap between the
  // first two start times of the first category block (same rows the table
  // shows), falling back to "—" when there's nothing to derive it from.
  const intervalSeconds = inferIntervalSeconds(rows);

  const stageDateLabel = formatStageDate(stage.date);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 md:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{stage.name}</h1>
        <p className="text-muted-foreground">{race.name}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          El orden de salida de esta etapa aún no se ha publicado. Vuelve a
          consultar más cerca del día de la carrera.
        </p>
      ) : (
        <StartListView
          raceName={race.name}
          stageName={stage.name}
          stageDateLabel={stageDateLabel}
          intervalSeconds={intervalSeconds}
          rows={rows}
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

/**
 * Infers the seconds between consecutive riders from the first category's own
 * start times (mirrors `inferIntervalSeconds` in `lib/tt-start-order.ts`, but
 * that one is scoped to a single already-grouped category run — here we first
 * need to find the first category's block from the flat position-ordered
 * rows). Returns `null` when there are fewer than two timed riders to compare.
 */
function inferIntervalSeconds(rows: StartListRow[]): number | null {
  const byPosition = [...rows].sort((a, b) => a.position - b.position);
  const firstCategoryId = byPosition[0]?.category_id;
  const firstCategoryRows = byPosition.filter(
    (r) => r.category_id === firstCategoryId,
  );
  for (let i = 1; i < firstCategoryRows.length; i++) {
    const prev = firstCategoryRows[i - 1].start_time;
    const curr = firstCategoryRows[i].start_time;
    if (!prev || !curr) continue;
    const prevMs = new Date(prev).getTime();
    const currMs = new Date(curr).getTime();
    if (Number.isNaN(prevMs) || Number.isNaN(currMs)) continue;
    const deltaSeconds = Math.round((currMs - prevMs) / 1000);
    if (deltaSeconds > 0) return deltaSeconds;
  }
  return null;
}

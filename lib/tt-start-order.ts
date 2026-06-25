import type { createAdminClient } from "@/lib/supabase/admin";
import { computeGc, type GcRegistration, type GcResult, type GcStage } from "@/lib/gc";

/**
 * TT start-order generation + the shared read helper (Story 11).
 *
 * Start order is persisted in the `tt_start_order` table (Story 01 schema):
 * one row per (stage, registration) with a 1-based `position` (unique within
 * the stage) and an absolute `start_time` timestamp. Generation is an explicit
 * organizer write — the route handler computes the ordering with the pure
 * functions here and replaces the stored rows.
 *
 * This module is the single source of truth for the start-order *shape* and
 * *read path* so Story 12 (manual reorder) and Story 13 (public start list)
 * reuse the same `loadStartOrder` helper and `StartOrderEntry` shape instead
 * of re-querying/re-joining.
 *
 * ## Generation rules (Story 11)
 * - Riders are grouped by category in the race's category `sort_order`
 *   (index 0 starts first). Each category's riders start as one contiguous
 *   block; a configurable gap separates categories.
 * - **Opening TT** (`stage_number = 1` or no prior stage has locked results):
 *   within-category order is **random** (Fisher–Yates).
 * - **Mid-race TT** (at least one prior stage has locked results): within
 *   category order is **inverse GC** — the category GC leader starts last,
 *   the slowest ranked rider starts first.
 * - DNS registrations are excluded. For a mid-race TT, riders with no GC
 *   standing (any DNF/DSQ/DNS on a prior completed stage) are also excluded.
 * - Start times: rider N within a category = first-rider time + cumulative
 *   intervals; the first rider of each next category adds `interval + gap`
 *   after the previous category's last rider.
 */

const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

export type StartOrderConfig = {
  /** Seconds between consecutive riders within a category. */
  intervalSeconds: number;
  /** Extra seconds between the last rider of one category and the next. */
  categoryGapSeconds: number;
  /** Time of day the first rider departs, `HH:MM:SS` (local race date). */
  firstStartTime: string;
};

export const DEFAULT_START_ORDER_CONFIG: StartOrderConfig = {
  intervalSeconds: 60,
  categoryGapSeconds: 300,
  firstStartTime: "10:00:00",
};

/** Returns a Spanish error string if the config is invalid, otherwise null. */
export function validateStartOrderConfig(
  config: StartOrderConfig,
): string | null {
  if (
    !Number.isFinite(config.intervalSeconds) ||
    !Number.isInteger(config.intervalSeconds) ||
    config.intervalSeconds < 1
  ) {
    return "El intervalo entre corredores debe ser un número entero de segundos mayor que cero.";
  }
  if (
    !Number.isFinite(config.categoryGapSeconds) ||
    !Number.isInteger(config.categoryGapSeconds) ||
    config.categoryGapSeconds < 0
  ) {
    return "El intervalo entre categorías debe ser un número entero de segundos no negativo.";
  }
  if (!TIME_OF_DAY_RE.test(config.firstStartTime)) {
    return "La hora de salida del primer corredor debe tener el formato HH:MM:SS.";
  }
  return null;
}

/** A rider eligible to appear in a start order. */
export type StartOrderRider = {
  registration_id: string;
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  category_id: string;
  category_name: string;
  category_sort_order: number;
  registration_status: "confirmed" | "dns";
};

/** The computed plan for one rider: position + absolute start time. */
export type StartOrderPlanEntry = {
  registration_id: string;
  position: number; // 1-based across the whole stage
  start_time: string; // ISO timestamp
};

export type StartOrderPlan = {
  entries: StartOrderPlanEntry[];
  /** `true` when inverse-GC ordering was used (a prior stage was completed). */
  usedGc: boolean;
};

/**
 * Fisher–Yates shuffle (matches `lib/riders.ts` bib assignment). Returns a
 * shuffled copy; the input is not mutated.
 */
function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Builds the absolute ISO start time for a rider at a cumulative second offset
 * from the configured first-rider time of day, on the given race-local date.
 */
function startTimeFor(
  stageDate: string, // yyyy-MM-dd
  firstStartTime: string, // HH:MM:SS
  offsetSeconds: number,
): string {
  // Compose the first-rider instant as a local-ish ISO and add the offset.
  // Stage dates are stored as plain dates; we anchor at the configured time of
  // day and shift by the cumulative interval. Using a Date keeps DST/rollover
  // correct without pulling in extra deps.
  const base = new Date(`${stageDate}T${firstStartTime}`);
  const at = new Date(base.getTime() + offsetSeconds * 1000);
  return at.toISOString();
}

/**
 * Computes the full start-order plan from already-loaded rows. Pure — the
 * route handler does the I/O and persistence.
 *
 * @param riders        All registrations for the race (confirmed + DNS).
 * @param stageNumber   The TT stage's `stage_number`.
 * @param stageDate     The TT stage's date (yyyy-MM-dd), anchors start times.
 * @param config        Interval / gap / first start time.
 * @param priorStages   Completed (locked) stages *before* this one, for GC.
 * @param priorResults  Result rows for those completed stages.
 */
export function computeStartOrder(
  riders: readonly StartOrderRider[],
  stageNumber: number,
  stageDate: string,
  config: StartOrderConfig,
  priorStages: readonly GcStage[],
  priorResults: readonly GcResult[],
): StartOrderPlan {
  // Mid-race iff there is at least one completed (locked) prior stage.
  const usedGc = stageNumber > 1 && priorStages.length > 0;

  const confirmed = riders.filter((r) => r.registration_status !== "dns");

  // Group by category, ordered by sort_order (index 0 first).
  const byCategory = new Map<
    string,
    { sortOrder: number; riders: StartOrderRider[] }
  >();
  for (const r of confirmed) {
    const entry = byCategory.get(r.category_id);
    if (entry) entry.riders.push(r);
    else byCategory.set(r.category_id, { sortOrder: r.category_sort_order, riders: [r] });
  }
  const categories = [...byCategory.entries()].sort(
    (a, b) => a[1].sortOrder - b[1].sortOrder,
  );

  // For mid-race, build per-category inverse-GC ordering and the set of riders
  // ranked in GC (everyone else is excluded from the start order).
  // `gcOrder` maps registration_id → its inverse-GC index within the category
  // (leader gets the largest index so it sorts last).
  const gcRankByCategory = new Map<string, Map<string, number>>();
  const gcEligible = new Set<string>();
  if (usedGc) {
    const gcRegistrations: GcRegistration[] = confirmed.map((r) => ({
      registration_id: r.registration_id,
      bib_number: r.bib_number,
      rider_name: r.rider_name,
      team: r.team,
      category_id: r.category_id,
      category_name: r.category_name,
      category_sort_order: r.category_sort_order,
      registration_status: r.registration_status,
    }));
    const gc = computeGc(priorStages, gcRegistrations, priorResults);
    for (const cat of gc.categories) {
      const rankMap = new Map<string, number>();
      // gc.ranked is fastest-first; inverse so leader (index 0) starts last.
      const n = cat.ranked.length;
      cat.ranked.forEach((ranked, index) => {
        gcEligible.add(ranked.registration_id);
        rankMap.set(ranked.registration_id, n - 1 - index);
      });
      gcRankByCategory.set(cat.category_id, rankMap);
    }
  }

  const entries: StartOrderPlanEntry[] = [];
  let position = 0;
  let offsetSeconds = 0;
  let isFirstCategory = true;

  for (const [categoryId, group] of categories) {
    let ordered: StartOrderRider[];
    if (usedGc) {
      const rankMap = gcRankByCategory.get(categoryId);
      // Exclude riders without a GC standing (DNF/DSQ/DNS on a prior stage).
      ordered = group.riders
        .filter((r) => gcEligible.has(r.registration_id))
        .sort(
          (a, b) =>
            (rankMap?.get(a.registration_id) ?? 0) -
            (rankMap?.get(b.registration_id) ?? 0),
        );
    } else {
      ordered = shuffle(group.riders);
    }

    if (ordered.length === 0) continue;

    // Add the between-category gap before any category after the first that
    // actually contributes riders.
    if (!isFirstCategory) {
      offsetSeconds += config.intervalSeconds + config.categoryGapSeconds;
    }
    isFirstCategory = false;

    ordered.forEach((rider, indexInCategory) => {
      if (indexInCategory > 0) offsetSeconds += config.intervalSeconds;
      position += 1;
      entries.push({
        registration_id: rider.registration_id,
        position,
        start_time: startTimeFor(stageDate, config.firstStartTime, offsetSeconds),
      });
    });
  }

  return { entries, usedGc };
}

/**
 * Manual reorder (Story 12).
 *
 * Reorder is scoped to a single category: the organizer drags a rider to a
 * new position among the riders of their *own* category only. The plan:
 *  1. Read the full persisted order (`StartOrderEntry[]`, position-ordered).
 *  2. Split into per-category runs in the order they currently appear in the
 *     stage (this preserves the category gap placement — categories keep
 *     whatever relative order generation gave them).
 *  3. Within the target category's run, move the dragged rider to its new
 *     index and recompute that category's `position`s + `start_time`s from
 *     its own first rider's anchor time, using the interval inferred from
 *     the category's own existing entries (no stored config to re-read).
 *  4. Every other category keeps its existing `position`s/`start_time`s
 *     untouched — the gap between categories is therefore unaffected.
 *  5. Positions are renumbered 1..N across the whole stage in run order so
 *     `tt_start_order`'s unique `(stage_id, position)` constraint holds.
 */

/**
 * Infers the interval (seconds) between consecutive riders within a single
 * category from its own persisted start times. Falls back to the shared
 * default when the category has fewer than two timed riders (nothing to
 * infer from) or timestamps are missing/malformed.
 */
function inferIntervalSeconds(categoryEntries: readonly StartOrderEntry[]): number {
  for (let i = 1; i < categoryEntries.length; i++) {
    const prev = categoryEntries[i - 1].start_time;
    const curr = categoryEntries[i].start_time;
    if (!prev || !curr) continue;
    const prevMs = new Date(prev).getTime();
    const currMs = new Date(curr).getTime();
    if (Number.isNaN(prevMs) || Number.isNaN(currMs)) continue;
    const deltaSeconds = Math.round((currMs - prevMs) / 1000);
    if (deltaSeconds > 0) return deltaSeconds;
  }
  return DEFAULT_START_ORDER_CONFIG.intervalSeconds;
}

export type ReorderResult =
  | { ok: true; entries: StartOrderEntry[] }
  | { ok: false; error: string };

/**
 * Pure recompute for a within-category drag. `entries` is the full stage
 * order (any order; will be grouped by `position` ascending). `registrationId`
 * is the rider being moved; `toIndex` is its new 0-based index *within its
 * own category's block*. Returns the full updated entry list (all
 * categories, positions renumbered) or an error.
 *
 * Cross-category drags are rejected by the caller before this is invoked —
 * this function only ever reorders inside one category's run.
 */
export function reorderWithinCategory(
  entries: readonly StartOrderEntry[],
  registrationId: string,
  toIndex: number,
): ReorderResult {
  const sorted = [...entries].sort((a, b) => a.position - b.position);
  const moving = sorted.find((e) => e.registration_id === registrationId);
  if (!moving) {
    return { ok: false, error: "El corredor no está en el orden de salida." };
  }

  // Split into contiguous per-category runs, preserving first-seen order.
  const runs: { categoryId: string; rows: StartOrderEntry[] }[] = [];
  for (const entry of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.categoryId === entry.category_id) {
      last.rows.push(entry);
    } else {
      runs.push({ categoryId: entry.category_id, rows: [entry] });
    }
  }

  const run = runs.find((r) => r.categoryId === moving.category_id);
  if (!run) {
    return { ok: false, error: "El corredor no está en el orden de salida." };
  }

  const fromIndex = run.rows.findIndex(
    (e) => e.registration_id === registrationId,
  );
  const clampedTo = Math.max(0, Math.min(toIndex, run.rows.length - 1));
  if (fromIndex === clampedTo) {
    return { ok: true, entries: sorted };
  }

  const reordered = [...run.rows];
  const [removed] = reordered.splice(fromIndex, 1);
  reordered.splice(clampedTo, 0, removed);

  // Recompute start times for this category only, anchored at its own first
  // rider's existing start time, using the interval inferred from its own
  // (pre-move) entries. Other categories' start times are untouched, so the
  // gap to/from neighboring categories is unaffected.
  const anchor = run.rows[0]?.start_time ?? null;
  const intervalSeconds = inferIntervalSeconds(run.rows);
  const anchorMs = anchor ? new Date(anchor).getTime() : NaN;
  const recomputedRun = reordered.map((entry, index) => {
    if (anchor === null || Number.isNaN(anchorMs)) {
      return { ...entry, start_time: entry.start_time };
    }
    const startTime = new Date(
      anchorMs + index * intervalSeconds * 1000,
    ).toISOString();
    return { ...entry, start_time: startTime };
  });

  run.rows = recomputedRun;

  // Flatten back in run order and renumber positions 1..N across the stage.
  const flattened = runs.flatMap((r) => r.rows);
  const renumbered = flattened.map((entry, index) => ({
    ...entry,
    position: index + 1,
  }));

  return { ok: true, entries: renumbered };
}

type Admin = ReturnType<typeof createAdminClient>;

/** A stored start-order row joined with rider/category info for display. */
export type StartOrderEntry = {
  id: string;
  registration_id: string;
  position: number;
  start_time: string | null;
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  category_id: string;
  category_name: string;
  category_sort_order: number;
};

/**
 * Loads the persisted start order for a stage, joined with rider + category
 * info, ordered by `position`. Returns `[]` when none has been generated.
 *
 * Shared read path for the organizer start-order screen (Story 11), manual
 * reorder (Story 12), and the public start list (Story 13) — they all consume
 * `StartOrderEntry[]` in the same shape so ordering/joining lives in one place.
 */
export async function loadStartOrder(
  admin: Admin,
  stageId: string,
): Promise<StartOrderEntry[]> {
  const { data, error } = await admin
    .from("tt_start_order")
    .select(
      "id, registration_id, position, start_time, registrations(bib_number, category_id, categories(id, name, sort_order), riders(name, team))",
    )
    .eq("stage_id", stageId)
    .order("position", { ascending: true });

  if (error || !data) return [];

  const entries: StartOrderEntry[] = [];
  for (const row of data) {
    const registration = row.registrations as unknown as {
      bib_number: number | null;
      category_id: string;
      categories: { id: string; name: string; sort_order: number } | null;
      riders: { name: string; team: string | null } | null;
    } | null;
    if (!registration?.categories || !registration.riders) continue;
    entries.push({
      id: row.id,
      registration_id: row.registration_id,
      position: row.position,
      start_time: row.start_time,
      bib_number: registration.bib_number,
      rider_name: registration.riders.name,
      team: registration.riders.team,
      category_id: registration.categories.id,
      category_name: registration.categories.name,
      category_sort_order: registration.categories.sort_order,
    });
  }
  return entries;
}

/**
 * Replaces the stored start order for a stage with `entries` in a single
 * transaction-like sequence: delete existing rows, insert the new plan. The
 * unique `(stage_id, position)` / `(stage_id, registration_id)` constraints
 * keep the table consistent. Caller handles authorization + validation.
 */
export async function replaceStartOrder(
  admin: Admin,
  stageId: string,
  entries: readonly StartOrderPlanEntry[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: deleteError } = await admin
    .from("tt_start_order")
    .delete()
    .eq("stage_id", stageId);
  if (deleteError) {
    return { ok: false, error: "No se pudo regenerar el orden de salida. Inténtalo de nuevo." };
  }

  if (entries.length === 0) return { ok: true };

  const { error: insertError } = await admin.from("tt_start_order").insert(
    entries.map((e) => ({
      stage_id: stageId,
      registration_id: e.registration_id,
      position: e.position,
      start_time: e.start_time,
    })),
  );
  if (insertError) {
    return { ok: false, error: "No se pudo guardar el orden de salida. Inténtalo de nuevo." };
  }
  return { ok: true };
}

/**
 * Persists the `position`/`start_time` of each given (already-existing)
 * `tt_start_order` row after a manual reorder (Story 12). Updates rows by
 * `id` rather than delete+insert so a partial failure can't drop rows that
 * `replaceStartOrder` would have deleted first.
 */
export async function persistReorderedPositions(
  admin: Admin,
  entries: readonly StartOrderEntry[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const entry of entries) {
    const { error } = await admin
      .from("tt_start_order")
      .update({ position: entry.position, start_time: entry.start_time })
      .eq("id", entry.id);
    if (error) {
      return {
        ok: false,
        error: "No se pudo guardar el nuevo orden. Inténtalo de nuevo.",
      };
    }
  }
  return { ok: true };
}

/**
 * Returns `true` once the live TT session has started for the stage — the
 * point at which the start order becomes read-only (Story 12's lock; written
 * by Story 17). There is no dedicated "session started" flag yet: Story 17
 * records the session anchor as one `stage_category_starts` row per category
 * the moment the operator taps Start, so the existence of any row for this
 * stage is the signal.
 */
export async function isStartOrderLocked(
  admin: Admin,
  stageId: string,
): Promise<boolean> {
  const { count } = await admin
    .from("stage_category_starts")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  return (count ?? 0) > 0;
}

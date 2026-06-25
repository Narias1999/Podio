import { formatSecondsToTime } from "@/lib/results";
import type { ResultStatus } from "@/types/app";

/**
 * Shared shaping for the public stage-results page (Story 14).
 *
 * Like `lib/gc.ts`, this takes plain already-loaded row shapes (not a Supabase
 * client) so it stays trivially testable and can be reused from the server
 * component (initial render) and re-run after a Realtime refresh. It groups a
 * stage's results by category, orders finishers by position/time, computes the
 * gap to the category leader (`—` for the leader, `+ H:MM:SS` otherwise), and
 * lists DNF/DSQ/DNS riders below the finishers in each category.
 *
 * Time shown is `net_seconds` (the same value used for GC). For TT stages the
 * UI labels this column "Tiempo neto" with an explanatory tooltip; for every
 * other stage type it labels it "Tiempo" — the underlying number is identical,
 * only the label/tooltip differ, so this helper doesn't branch on stage type.
 */

/** A registration scoped to the stage's race, with category + rider denormalised. */
export type PublicResultRegistration = {
  registration_id: string;
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  category_id: string;
  category_name: string;
  category_sort_order: number;
  /** `dns` registration status means the rider never started the race. */
  registration_status: "confirmed" | "dns";
};

/** A single stage result row (only the fields the public page needs). */
export type PublicResultRow = {
  registration_id: string;
  status: ResultStatus;
  net_seconds: number | null;
  position: number | null;
};

/** One finisher within a category's stage standings. */
export type PublicFinisher = {
  registration_id: string;
  position: number; // 1-based rank within the category
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  net_time: string; // formatted "H:MM:SS"
  gap_to_leader: string; // "—" for the leader, "+ H:MM:SS" otherwise
};

/** A rider who did not finish, shown below the finishers. */
export type PublicNonFinisher = {
  registration_id: string;
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  status: Exclude<ResultStatus, "finished">;
};

/** Stage standings for a single category. */
export type PublicCategoryResults = {
  category_id: string;
  category_name: string;
  category_sort_order: number;
  finishers: PublicFinisher[];
  nonFinishers: PublicNonFinisher[];
};

export type PublicStageResults = {
  categories: PublicCategoryResults[];
  /** True when at least one finisher exists across all categories. */
  hasAnyResult: boolean;
};

/**
 * Builds the per-category public standings for a stage from already-loaded
 * rows. A rider with no result row is treated as `dns` (never recorded).
 */
export function buildStageResults(
  registrations: readonly PublicResultRegistration[],
  results: readonly PublicResultRow[],
): PublicStageResults {
  const resultByRegistration = new Map(
    results.map((r) => [r.registration_id, r]),
  );

  const categories = new Map<
    string,
    {
      category_id: string;
      category_name: string;
      category_sort_order: number;
      registrations: PublicResultRegistration[];
    }
  >();
  for (const reg of registrations) {
    let entry = categories.get(reg.category_id);
    if (!entry) {
      entry = {
        category_id: reg.category_id,
        category_name: reg.category_name,
        category_sort_order: reg.category_sort_order,
        registrations: [],
      };
      categories.set(reg.category_id, entry);
    }
    entry.registrations.push(reg);
  }

  let hasAnyResult = false;
  const categoryResults: PublicCategoryResults[] = [];

  for (const category of categories.values()) {
    type Finished = {
      reg: PublicResultRegistration;
      netSeconds: number;
      position: number | null;
    };
    const finished: Finished[] = [];
    const nonFinishers: PublicNonFinisher[] = [];

    for (const reg of category.registrations) {
      const result = resultByRegistration.get(reg.registration_id);

      if (reg.registration_status === "dns") {
        nonFinishers.push(toNonFinisher(reg, "dns"));
        continue;
      }

      if (
        result &&
        result.status === "finished" &&
        result.net_seconds != null
      ) {
        finished.push({
          reg,
          netSeconds: result.net_seconds,
          position: result.position,
        });
        continue;
      }

      // Non-finished or no recorded result. Capture the explicit reason
      // (dnf/dsq), otherwise treat a missing/unrecorded result as dns.
      const status: Exclude<ResultStatus, "finished"> =
        result && result.status !== "finished"
          ? (result.status as Exclude<ResultStatus, "finished">)
          : "dns";
      nonFinishers.push(toNonFinisher(reg, status));
    }

    finished.sort((a, b) => {
      // Order primarily by recorded position when available; fall back to net
      // time so the leader (position 1 / lowest time) is always first.
      const aPos = a.position ?? Number.POSITIVE_INFINITY;
      const bPos = b.position ?? Number.POSITIVE_INFINITY;
      if (aPos !== bPos) return aPos - bPos;
      if (a.netSeconds !== b.netSeconds) return a.netSeconds - b.netSeconds;
      return (a.reg.bib_number ?? Infinity) - (b.reg.bib_number ?? Infinity);
    });

    if (finished.length > 0) hasAnyResult = true;

    const leaderSeconds = finished.length > 0 ? finished[0].netSeconds : 0;
    const finishers: PublicFinisher[] = finished.map((f, index) => ({
      registration_id: f.reg.registration_id,
      position: index + 1,
      bib_number: f.reg.bib_number,
      rider_name: f.reg.rider_name,
      team: f.reg.team,
      net_time: formatSecondsToTime(f.netSeconds),
      gap_to_leader:
        index === 0
          ? "—"
          : `+ ${formatSecondsToTime(f.netSeconds - leaderSeconds)}`,
    }));

    nonFinishers.sort(
      (a, b) => (a.bib_number ?? Infinity) - (b.bib_number ?? Infinity),
    );

    categoryResults.push({
      category_id: category.category_id,
      category_name: category.category_name,
      category_sort_order: category.category_sort_order,
      finishers,
      nonFinishers,
    });
  }

  categoryResults.sort(
    (a, b) => a.category_sort_order - b.category_sort_order,
  );

  return { categories: categoryResults, hasAnyResult };
}

function toNonFinisher(
  reg: PublicResultRegistration,
  status: Exclude<ResultStatus, "finished">,
): PublicNonFinisher {
  return {
    registration_id: reg.registration_id,
    bib_number: reg.bib_number,
    rider_name: reg.rider_name,
    team: reg.team,
    status,
  };
}

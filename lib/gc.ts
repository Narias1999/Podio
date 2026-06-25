import { formatSecondsToTime } from "@/lib/results";
import type { ResultStatus } from "@/types/app";

/**
 * General Classification (GC) aggregation — Story 10.
 *
 * GC is a **pure derived computation**, not persisted state: it is the
 * cumulative sum of each rider's `net_seconds` across the stages that have
 * been completed (`stages.results_locked = true`). Computing it on read means
 * it is always consistent with the underlying results — it "updates
 * automatically" whenever a stage result is saved, edited, or a stage is
 * locked/unlocked (Story 10 acceptance criteria), with no separate write path
 * to keep in sync.
 *
 * This helper is the single source of truth for GC so the organizer GC tab
 * (Story 10), the public results page GC tab (Story 14), and the live
 * classification views (Stories 19/22) all rank riders identically. It takes
 * plain row shapes (not a Supabase client) so it stays trivially testable and
 * reusable from any caller that has already loaded the data.
 *
 * ## Rules implemented
 * - **Eligibility for ranked standings:** a rider is ranked only if, across
 *   *every completed stage*, they have a `finished` result. A rider with any
 *   `dnf`/`dsq`/`dns` on any completed stage — or with a missing result row on
 *   a completed stage (e.g. never recorded / DNS via registration) — is
 *   excluded from the ranked standings and listed under "Non-finishers" with
 *   their most relevant non-finished status.
 * - **GC time:** sum of `net_seconds` over the completed stages for ranked
 *   riders. (Ranked riders necessarily finished every completed stage, so the
 *   sum spans all of them — this is "partial GC" when only some stages are
 *   locked.)
 * - **Per category:** riders are ranked within their registration category
 *   only; there is no cross-category ranking. Each category produces its own
 *   ordered standings and its own leader.
 * - **Ordering & tie-breaking:** ranked by ascending total time; ties are
 *   broken by the rider's best (lowest) cumulative position across completed
 *   stages, then by bib number, so the order is deterministic.
 * - **Gap to leader:** the category leader shows `—`; everyone else shows
 *   `+ H:MM:SS` relative to that category's leader.
 */

/** A completed (results-locked) stage, in `stage_number` order. */
export type GcStage = {
  id: string;
  stage_number: number;
};

/** A registration scoped to the race, with its category + rider denormalised. */
export type GcRegistration = {
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

/** A single stage result row (only the fields GC needs). */
export type GcResult = {
  stage_id: string;
  registration_id: string;
  status: ResultStatus;
  net_seconds: number | null;
  position: number | null;
};

/** One ranked rider within a category's GC standings. */
export type GcRankedRider = {
  registration_id: string;
  position: number; // 1-based rank within the category
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  total_seconds: number;
  total_time: string; // formatted "H:MM:SS"
  gap_to_leader: string; // "—" for the leader, "+ H:MM:SS" otherwise
};

/** A rider excluded from the ranked standings, with their status. */
export type GcNonFinisher = {
  registration_id: string;
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  /** The status that disqualified them from GC (`dnf`/`dsq`/`dns`). */
  status: Exclude<ResultStatus, "finished">;
};

/** GC standings for a single category. */
export type GcCategoryStandings = {
  category_id: string;
  category_name: string;
  category_sort_order: number;
  ranked: GcRankedRider[];
  nonFinishers: GcNonFinisher[];
};

export type GcStandings = {
  /** Completed stages included in the computation, in `stage_number` order. */
  stages: GcStage[];
  /** Per-category standings, ordered by category `sort_order`. */
  categories: GcCategoryStandings[];
};

/**
 * Computes the General Classification from already-loaded rows.
 *
 * @param stages       Only the **completed** stages (`results_locked = true`).
 *                     If empty, every category yields empty `ranked` lists.
 * @param registrations All registrations for the race (one row per rider).
 * @param results      All result rows for the completed stages.
 */
export function computeGc(
  stages: readonly GcStage[],
  registrations: readonly GcRegistration[],
  results: readonly GcResult[],
): GcStandings {
  const completedStages = [...stages].sort(
    (a, b) => a.stage_number - b.stage_number,
  );
  const completedStageIds = new Set(completedStages.map((s) => s.id));

  // Index results by registration → stage (only for completed stages).
  const resultsByRegistration = new Map<string, Map<string, GcResult>>();
  for (const result of results) {
    if (!completedStageIds.has(result.stage_id)) continue;
    let byStage = resultsByRegistration.get(result.registration_id);
    if (!byStage) {
      byStage = new Map();
      resultsByRegistration.set(result.registration_id, byStage);
    }
    byStage.set(result.stage_id, result);
  }

  // Group registrations by category, preserving sort order.
  const categories = new Map<
    string,
    {
      category_id: string;
      category_name: string;
      category_sort_order: number;
      registrations: GcRegistration[];
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

  const categoryStandings: GcCategoryStandings[] = [];

  for (const category of categories.values()) {
    type Eligible = {
      reg: GcRegistration;
      totalSeconds: number;
      bestPosition: number; // sum of stage positions (tie-break), Infinity if any missing
    };
    const eligible: Eligible[] = [];
    const nonFinishers: GcNonFinisher[] = [];

    for (const reg of category.registrations) {
      // A rider flagged DNS at registration never started — straight to
      // non-finishers regardless of any stray result rows.
      if (reg.registration_status === "dns") {
        nonFinishers.push(toNonFinisher(reg, "dns"));
        continue;
      }

      const byStage = resultsByRegistration.get(reg.registration_id);
      let total = 0;
      let positionSum = 0;
      let hasPosition = true;
      let disqualifyingStatus: Exclude<ResultStatus, "finished"> | null = null;

      for (const stage of completedStages) {
        const result = byStage?.get(stage.id);
        if (
          !result ||
          result.status !== "finished" ||
          result.net_seconds == null
        ) {
          // No finished time on a completed stage → not GC-eligible. Capture
          // the most explicit reason (dnf/dsq), otherwise treat as dns.
          if (result && result.status !== "finished") {
            disqualifyingStatus = result.status;
          } else if (disqualifyingStatus == null) {
            disqualifyingStatus = "dns";
          }
          continue;
        }
        total += result.net_seconds;
        if (result.position == null) {
          hasPosition = false;
        } else {
          positionSum += result.position;
        }
      }

      if (disqualifyingStatus != null) {
        nonFinishers.push(toNonFinisher(reg, disqualifyingStatus));
        continue;
      }

      // Ranked only if there is at least one completed stage to sum.
      if (completedStages.length === 0) continue;

      eligible.push({
        reg,
        totalSeconds: total,
        bestPosition: hasPosition ? positionSum : Number.POSITIVE_INFINITY,
      });
    }

    eligible.sort((a, b) => {
      if (a.totalSeconds !== b.totalSeconds) {
        return a.totalSeconds - b.totalSeconds;
      }
      if (a.bestPosition !== b.bestPosition) {
        return a.bestPosition - b.bestPosition;
      }
      return (a.reg.bib_number ?? Infinity) - (b.reg.bib_number ?? Infinity);
    });

    const leaderSeconds = eligible.length > 0 ? eligible[0].totalSeconds : 0;
    const ranked: GcRankedRider[] = eligible.map((e, index) => ({
      registration_id: e.reg.registration_id,
      position: index + 1,
      bib_number: e.reg.bib_number,
      rider_name: e.reg.rider_name,
      team: e.reg.team,
      total_seconds: e.totalSeconds,
      total_time: formatSecondsToTime(e.totalSeconds),
      gap_to_leader:
        index === 0
          ? "—"
          : `+ ${formatSecondsToTime(e.totalSeconds - leaderSeconds)}`,
    }));

    // Stable order for non-finishers (by bib for readability).
    nonFinishers.sort(
      (a, b) => (a.bib_number ?? Infinity) - (b.bib_number ?? Infinity),
    );

    categoryStandings.push({
      category_id: category.category_id,
      category_name: category.category_name,
      category_sort_order: category.category_sort_order,
      ranked,
      nonFinishers,
    });
  }

  categoryStandings.sort(
    (a, b) => a.category_sort_order - b.category_sort_order,
  );

  return { stages: completedStages, categories: categoryStandings };
}

function toNonFinisher(
  reg: GcRegistration,
  status: Exclude<ResultStatus, "finished">,
): GcNonFinisher {
  return {
    registration_id: reg.registration_id,
    bib_number: reg.bib_number,
    rider_name: reg.rider_name,
    team: reg.team,
    status,
  };
}

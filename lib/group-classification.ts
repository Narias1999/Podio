import type { createAdminClient } from "@/lib/supabase/admin";
import { rankByNetSeconds } from "@/lib/tt-classification";

/**
 * Live group/road-stage classification — Story 22.
 *
 * After a group's finish results are upserted (Story 21 `lib/group-finish.ts`),
 * every affected category is re-ranked so the stored `position` reflects the
 * latest set of net times. This is the group-stage analogue of Story 19's
 * `reclassifyTtCategory`, with two differences:
 *
 *  1. A single saved group can span MULTIPLE categories (different waves can
 *     finish together), so positioning runs per *touched* category, not just
 *     the one rider's category. `reclassifyGroupCategories` takes the set of
 *     category ids the saved group touched and re-ranks each.
 *  2. The tie-break adds `group_position` ascending BEFORE `captured_at`, so
 *     members of the same group sharing the same `net_seconds` rank by the
 *     operator-set within-group order. This is handled inside the shared
 *     `rankByNetSeconds` helper (Story 19), which is reused here verbatim.
 *
 * ## Ranking rules (spec §"Position assignment")
 * - Scope: re-rank each category touched by the saved group.
 * - Only `finished` results with a non-null `net_seconds` are ranked. A rider
 *   whose category never started (no `stage_category_starts.started_at`) is
 *   saved with `net_seconds = null` (Story 22 missing-start handling) and is
 *   skipped here — it keeps `position = null` and is listed below ranked
 *   finishers on the public page, exactly like a DNF/DSQ.
 * - Order by `net_seconds` ascending, tie-break `group_position` asc → then
 *   earlier `captured_at` → then lower `bib_number`. Positions `1, 2, 3…`.
 *
 * ## GC + Realtime
 * GC is a pure derived computation (`lib/gc.ts`), recomputed on read by the
 * public page (Story 14) from the `results` rows it is subscribed to — there is
 * no stored GC table to update. The public page subscribes to Postgres changes
 * on `public.results` filtered by `stage_id`, so the position writes here (and
 * the finish upserts before them) already push to the public stage results
 * **and** trigger the public GC tab to recompute. No separate GC write or
 * broadcast is needed.
 *
 * Idempotent: re-running with the same data writes the same positions. Only
 * rows whose position actually changes are updated, so a no-op save is a no-op
 * write (and won't emit spurious Realtime events). Ranking uses the stored
 * `captured_at` / `net_seconds`, never write-arrival order, so out-of-order
 * delivery and near-simultaneous groups classify deterministically.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Postgres transient-conflict SQLSTATEs. When several riders of one group are
 * saved, the write queue flushes their POSTs concurrently; each POST upserts a
 * `results` row and then re-ranks its category by reading every `finished` row
 * in the stage. Two such requests touching the same stage's `results` table can
 * briefly collide and Postgres aborts one with a serialization failure
 * (`40001`) or deadlock (`40P01`). These are safe to retry — re-running the
 * read/compute/persist is idempotent (positions are derived from stored
 * `net_seconds`, never write order). Retrying here keeps the route from
 * surfacing a hard 500 for a self-healing conflict, so every rider in the group
 * lands on the first flush instead of waiting for a later retry.
 */
const TRANSIENT_PG_CODES = new Set(["40001", "40P01"]);

function isTransientDbError(error: { code?: string | null } | null): boolean {
  return !!error?.code && TRANSIENT_PG_CODES.has(error.code);
}

/**
 * Run a Supabase query builder with a few short retries when it fails with a
 * transient serialization/deadlock error. The builder factory is re-invoked on
 * each attempt (Supabase query builders are single-use / thenable).
 */
async function withTransientRetry<T>(
  run: () => PromiseLike<{ data: T; error: { code?: string | null } | null }>,
  attempts = 4,
): Promise<{ data: T; error: { code?: string | null } | null }> {
  let result = await run();
  for (let i = 1; i < attempts && isTransientDbError(result.error); i++) {
    // Small jittered backoff so the two colliding requests don't lockstep-retry.
    await new Promise((resolve) => setTimeout(resolve, 25 * i + Math.random() * 25));
    result = await run();
  }
  return result;
}

export type ReclassifyGroupResult =
  | { ok: true; categoryIds: string[] }
  | { ok: false; error: string };

/**
 * Re-ranks every category in `categoryIds` among `stageId`'s saved `finished`
 * results, persisting `position = 1, 2, 3…` by ascending `net_seconds`
 * (tie-break: `group_position` asc, then earlier `captured_at`, then lower
 * `bib_number`). Rows with a null `net_seconds` are excluded from ranking.
 */
export async function reclassifyGroupCategories(
  admin: Admin,
  stageId: string,
  categoryIds: readonly string[],
): Promise<ReclassifyGroupResult> {
  const targetCategories = new Set(categoryIds.filter(Boolean));
  if (targetCategories.size === 0) {
    return { ok: true, categoryIds: [] };
  }

  // Load every finished result in the stage joined with the rider's category +
  // bib so we can filter to each touched category and rank deterministically.
  const { data, error } = await withTransientRetry(() =>
    admin
      .from("results")
      .select(
        "registration_id, net_seconds, group_position, captured_at, position, registrations(bib_number, category_id)",
      )
      .eq("stage_id", stageId)
      .eq("status", "finished"),
  );

  if (error || !data) {
    return { ok: false, error: "No se pudo clasificar el resultado." };
  }

  type RankRow = {
    registration_id: string;
    net_seconds: number;
    group_position: number | null;
    captured_at: string | null;
    bib_number: number | null;
    position: number | null;
  };

  // Bucket rankable rows by category in a single pass.
  const byCategory = new Map<string, RankRow[]>();
  for (const row of data) {
    const registration = row.registrations as unknown as {
      bib_number: number | null;
      category_id: string;
    } | null;
    if (!registration) continue;
    if (!targetCategories.has(registration.category_id)) continue;
    if (row.net_seconds == null) continue; // missing-start rider — skip ranking
    let bucket = byCategory.get(registration.category_id);
    if (!bucket) {
      bucket = [];
      byCategory.set(registration.category_id, bucket);
    }
    bucket.push({
      registration_id: row.registration_id,
      net_seconds: row.net_seconds,
      group_position: row.group_position,
      captured_at: row.captured_at,
      bib_number: registration.bib_number,
      position: row.position,
    });
  }

  for (const bucket of byCategory.values()) {
    const ranked = rankByNetSeconds(bucket);
    for (let i = 0; i < ranked.length; i++) {
      const desiredPosition = i + 1;
      if (ranked[i].position === desiredPosition) continue;
      const { error: updateError } = await withTransientRetry(() =>
        admin
          .from("results")
          .update({ position: desiredPosition })
          .eq("stage_id", stageId)
          .eq("registration_id", ranked[i].registration_id),
      );
      if (updateError) {
        return { ok: false, error: "No se pudo clasificar el resultado." };
      }
    }
  }

  return { ok: true, categoryIds: [...targetCategories] };
}

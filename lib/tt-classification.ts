import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Live TT classification — Story 19.
 *
 * After a TT finish result is upserted (Story 18 `lib/tt-finish.ts`), the
 * rider's position within their **category** is (re)assigned by ranking every
 * saved `finished` result in that category by `net_seconds` ascending. This
 * runs server-side inside the authorized finish route on every save and every
 * overwrite, so the stored `position` always reflects the latest set of times.
 *
 * ## Ranking rules (spec §"Position assignment")
 * - Scope: re-rank only the category of the rider that was just saved. A single
 *   finish only ever changes ordering inside its own category, so one re-rank
 *   per save is sufficient and idempotent.
 * - Only `finished` results with a non-null `net_seconds` are ranked. DNF/DSQ
 *   results keep `position = null` (they appear below finishers on the public
 *   page) and are skipped here.
 * - Order by `net_seconds` ascending → `position = 1, 2, 3…`.
 * - **Tie-break** (deterministic, documented): equal `net_seconds` are broken by
 *   earlier `captured_at` (the rider whose STOP was tapped first ranks higher),
 *   then by `bib_number` ascending as a final stable fallback. This mirrors the
 *   public-results / GC tie-break philosophy and keeps the order stable across
 *   re-ranks regardless of result-row delivery order.
 *
 * ## GC
 * GC is a pure derived computation (`lib/gc.ts`), recomputed on read by the
 * public page (Story 14) from the `results` rows it is subscribed to — there is
 * no stored GC table to update. The public page subscribes to Postgres changes
 * on `public.results` filtered by `stage_id`, so the position writes performed
 * here (and the finish upsert before them) already push to the public stage
 * results **and** trigger the public GC tab to recompute. No separate GC write
 * or broadcast is needed.
 *
 * The position-by-category re-rank helper here is generic enough for Stories
 * 20–22 (group-stage live classification) to reuse: feed it the saved category
 * id and the ranking is identical (the group-stage tie-break may differ, but
 * the load/compute/persist shape is the same).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** A finished result row plus its rider's category, used for ranking. */
export type RankableResult = {
  registration_id: string;
  net_seconds: number;
  captured_at: string | null;
  bib_number: number | null;
  /**
   * Within-group finishing order, only set for group/road stages (Story 22).
   * Used as the *first* tiebreak when present so same-`net_seconds` members of
   * the same group rank by the operator-set order; null for TT (Story 19).
   */
  group_position?: number | null;
};

export type ReclassifyResult =
  | { ok: true; categoryId: string | null }
  | { ok: false; error: string };

/**
 * Resolves the `category_id` of a registration (the category drives ranking
 * scope). Returns null if the registration can't be read.
 */
async function loadRegistrationCategory(
  admin: Admin,
  registrationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("registrations")
    .select("category_id")
    .eq("id", registrationId)
    .maybeSingle();
  return data?.category_id ?? null;
}

/**
 * Re-ranks all saved `finished` results in `stageId` that belong to the same
 * category as `registrationId`, persisting `position = 1, 2, 3…` by ascending
 * `net_seconds` (tie-break: earlier `captured_at`, then lower `bib_number`).
 *
 * Idempotent: re-running with the same data writes the same positions. Only
 * rows whose position actually changes are updated, so a no-op save is a no-op
 * write (and won't emit spurious Realtime events).
 */
export async function reclassifyTtCategory(
  admin: Admin,
  stageId: string,
  registrationId: string,
): Promise<ReclassifyResult> {
  const categoryId = await loadRegistrationCategory(admin, registrationId);
  if (!categoryId) {
    // The just-saved registration must resolve; treat a missing category as a
    // soft failure so the caller can surface it without losing the upsert.
    return { ok: false, error: "No se pudo clasificar el resultado." };
  }

  // Load every finished result in the stage joined with the rider's category +
  // bib so we can both filter to this category and rank deterministically.
  const { data, error } = await admin
    .from("results")
    .select(
      "registration_id, net_seconds, captured_at, position, registrations(bib_number, category_id)",
    )
    .eq("stage_id", stageId)
    .eq("status", "finished");

  if (error || !data) {
    return { ok: false, error: "No se pudo clasificar el resultado." };
  }

  const inCategory: (RankableResult & { position: number | null })[] = [];
  for (const row of data) {
    const registration = row.registrations as unknown as {
      bib_number: number | null;
      category_id: string;
    } | null;
    if (!registration || registration.category_id !== categoryId) continue;
    if (row.net_seconds == null) continue; // finished rows always have one
    inCategory.push({
      registration_id: row.registration_id,
      net_seconds: row.net_seconds,
      captured_at: row.captured_at,
      bib_number: registration.bib_number,
      position: row.position,
    });
  }

  const ranked = rankByNetSeconds(inCategory);

  // Persist only changed positions to minimize writes / Realtime churn.
  for (let i = 0; i < ranked.length; i++) {
    const desiredPosition = i + 1;
    if (ranked[i].position === desiredPosition) continue;
    const { error: updateError } = await admin
      .from("results")
      .update({ position: desiredPosition })
      .eq("stage_id", stageId)
      .eq("registration_id", ranked[i].registration_id);
    if (updateError) {
      return { ok: false, error: "No se pudo clasificar el resultado." };
    }
  }

  return { ok: true, categoryId };
}

/**
 * Pure ranking of finished results by ascending `net_seconds`.
 *
 * Tie-break chain (deterministic and stable across re-ranks):
 *   1. `group_position` ascending — only meaningful for group/road stages
 *      (Story 22), where same-`net_seconds` riders are members of the same
 *      finishing group and the operator set their within-group order. Rows
 *      without a `group_position` (TT — Story 19) all share `Infinity` here,
 *      so this step is a no-op for them and the chain falls through unchanged.
 *   2. earlier `captured_at` — the rider whose STOP was tapped first.
 *   3. lower `bib_number` — final stable fallback.
 *
 * Exported for reuse/testing and for the group-stage classification stories
 * (20–22); `lib/group-classification.ts` reuses it directly.
 */
export function rankByNetSeconds<T extends RankableResult>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.net_seconds !== b.net_seconds) return a.net_seconds - b.net_seconds;
    const aGroup = a.group_position ?? Infinity;
    const bGroup = b.group_position ?? Infinity;
    if (aGroup !== bGroup) return aGroup - bGroup;
    const aCaptured = a.captured_at ? new Date(a.captured_at).getTime() : Infinity;
    const bCaptured = b.captured_at ? new Date(b.captured_at).getTime() : Infinity;
    if (aCaptured !== bCaptured) return aCaptured - bCaptured;
    return (a.bib_number ?? Infinity) - (b.bib_number ?? Infinity);
  });
}

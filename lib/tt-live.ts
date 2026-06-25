// Shared TT live-session helpers (Stories 17 & 18).
//
// During a live time-trial session the operator presses "Start TT" once. That
// press records a single authoritative anchor timestamp (`started_at`) — one
// `stage_category_starts` row per category, all sharing that same instant
// (Story 01 schema; Story 17 writes it, Story 12 reads its existence as the
// "session started" lock).
//
// Each rider's *scheduled departure* is then derived from the anchor plus the
// rider's planned offset. The planned offsets come from `tt_start_order`
// (Stories 11–13): every row stores an absolute planned `start_time`. We do NOT
// recompute interval/gap here — we reuse those already-computed planned times
// and simply re-anchor them so the live countdown is relative to the real
// press instant rather than the originally-configured first-rider time of day.
//
// Re-anchoring: a rider's offset from the first rider is
// `plannedStart(rider) - plannedStart(firstRider)`. The actual departure is
// `anchor + offset`. The first rider departs exactly at `anchor`. This keeps
// every interval/gap that Stories 11–13 baked into the planned times intact
// while letting the operator press Start at any real-world moment.
//
// This module is pure + framework-free so both the start-line view (Story 17)
// and the finish-line view (Story 18) import the same logic instead of
// duplicating it.

// ---------------------------------------------------------------------------
// Realtime channel convention (shared with Story 18)
// ---------------------------------------------------------------------------

/**
 * Realtime channel name for a stage's live TT session. The start-line view
 * (Story 17) broadcasts on this channel; the finish-line view (Story 18)
 * subscribes to it so it learns the anchor the instant Start is pressed.
 */
export function ttSessionChannel(stageId: string): string {
  return `tt:stage:${stageId}`;
}

/** Broadcast event fired when the operator presses Start TT. */
export const TT_STARTED_EVENT = "tt-started";

/** Payload broadcast with `TT_STARTED_EVENT` (and accepted by the API). */
export type TtStartedPayload = {
  stage_id: string;
  /** Authoritative session anchor — UTC ISO instant of the Start press. */
  started_at: string;
};

// ---------------------------------------------------------------------------
// Scheduled-departure computation
// ---------------------------------------------------------------------------

/** Minimal rider shape needed to schedule a departure. */
export type ScheduledRiderInput = {
  registration_id: string;
  position: number;
  /** Absolute planned start time (ISO) from `tt_start_order`. */
  start_time: string | null;
  bib_number: number | null;
  rider_name: string;
  category_id: string;
  category_name: string;
};

/** A rider with a concrete scheduled departure instant (ms epoch). */
export type ScheduledRider = {
  registration_id: string;
  position: number;
  bib_number: number | null;
  rider_name: string;
  category_id: string;
  category_name: string;
  /** Scheduled departure as ms epoch, derived from the anchor + planned offset. */
  scheduledAt: number;
};

/**
 * Re-anchors the planned start times of a start order to an actual session
 * anchor. Returns riders position-ordered, each with a concrete `scheduledAt`
 * (ms epoch). Riders missing a planned `start_time` are dropped (they can't be
 * scheduled). `anchorIso` is the `started_at` recorded on Start TT.
 *
 * The first scheduled rider (lowest position with a planned time) departs at
 * exactly `anchor`; every other rider departs at `anchor` plus its planned
 * offset from that first rider.
 */
export function computeScheduledDepartures(
  riders: readonly ScheduledRiderInput[],
  anchorIso: string,
): ScheduledRider[] {
  const anchorMs = new Date(anchorIso).getTime();
  if (Number.isNaN(anchorMs)) return [];

  const timed = riders
    .filter((r) => r.start_time !== null)
    .map((r) => ({ ...r, plannedMs: new Date(r.start_time as string).getTime() }))
    .filter((r) => !Number.isNaN(r.plannedMs))
    .sort((a, b) => a.position - b.position);

  if (timed.length === 0) return [];

  const firstPlannedMs = timed[0].plannedMs;

  return timed.map((r) => ({
    registration_id: r.registration_id,
    position: r.position,
    bib_number: r.bib_number,
    rider_name: r.rider_name,
    category_id: r.category_id,
    category_name: r.category_name,
    scheduledAt: anchorMs + (r.plannedMs - firstPlannedMs),
  }));
}

/**
 * Given position-ordered scheduled riders and the current instant, returns the
 * index of the "current" rider — the next rider yet to depart (the first whose
 * `scheduledAt` is still in the future, inclusive of exactly now). Returns
 * `riders.length` once everyone has departed (end-of-list), and `0` before the
 * first departure.
 */
export function currentRiderIndex(
  riders: readonly ScheduledRider[],
  nowMs: number,
): number {
  for (let i = 0; i < riders.length; i++) {
    if (riders[i].scheduledAt > nowMs) return i;
  }
  return riders.length;
}

// Shared group/road-stage live-session helpers (Stories 20 & 21).
//
// In a group stage the operator selects which categories are starting together
// and presses "Iniciar". Each such press is a "wave" — it records one
// `stage_category_starts` row per selected category, each carrying that wave's
// `started_at` timestamp. Multiple waves are supported (Story 20 spec).
//
// This module is pure + framework-free so both the start-line view (Story 20)
// and the finish-line view (Story 21) import the same constants instead of
// duplicating them.

// ---------------------------------------------------------------------------
// Realtime channel convention (shared with Story 21)
// ---------------------------------------------------------------------------

/**
 * Realtime channel name for a stage's live group session. The start-line view
 * (Story 20) broadcasts on this channel; the finish-line view (Story 21)
 * subscribes to it so it learns each wave the instant Iniciar is pressed.
 *
 * Example: `group:stage:abc123`
 */
export function groupSessionChannel(stageId: string): string {
  return `group:stage:${stageId}`;
}

/** Broadcast event fired when the operator presses Iniciar for a wave. */
export const GROUP_STARTED_EVENT = "group-started";

/**
 * Payload broadcast with `GROUP_STARTED_EVENT`.
 *
 * Story 21 subscribes to this to learn:
 *   - which categories started in the wave (`category_ids`)
 *   - the authoritative anchor for each category (`started_at`)
 *
 * Note: `stage_category_starts` rows are written per-category — each category
 * in the wave gets its own row with the same `started_at`. Story 21 reads
 * per-category `started_at` from those rows to compute net elapsed time for
 * each rider.
 */
export type GroupStartedPayload = {
  stage_id: string;
  /** IDs of the categories included in this wave. */
  category_ids: string[];
  /** Authoritative UTC ISO instant the Iniciar button was pressed. */
  started_at: string;
};

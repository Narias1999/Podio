import type { createAdminClient } from "@/lib/supabase/admin";
import type { ResultStatus } from "@/types/app";

/**
 * Shared time parsing/formatting + payload validation for manual results
 * entry (Story 08). This module is the single source of truth for the
 * `H:MM:SS` / `HH:MM:SS` finish-time format so the bulk CSV importer
 * (Story 09) and GC aggregation (Story 10) can reuse it instead of
 * reimplementing time math.
 *
 * Storage shape: a manually-entered finish time has no live start
 * timestamp to net out against, so the parsed duration (in seconds) is
 * stored in both `elapsed_seconds` and `net_seconds` — GC (Story 10) sums
 * `net_seconds` across stages, so it must always be populated for a
 * `finished` result regardless of entry method.
 */

const TIME_RE = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/;

/**
 * Parses a `H:MM:SS` or `HH:MM:SS` string into total seconds. Returns `null`
 * if the string doesn't match the expected format.
 */
export function parseTimeToSeconds(input: string): number | null {
  const trimmed = input.trim();
  const match = TIME_RE.exec(trimmed);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Formats a total-seconds duration back into `H:MM:SS` (no leading zero on
 * the hours component, matching the input format from the story).
 */
export function formatSecondsToTime(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

export const RESULT_STATUSES: readonly ResultStatus[] = [
  "finished",
  "dnf",
  "dsq",
  "dns",
];

export const RESULT_STATUS_LABELS: Record<ResultStatus, string> = {
  finished: "Finalizó",
  dnf: "DNF",
  dsq: "DSQ",
  dns: "DNS",
};

/** The fields the organizer edits per-rider on the manual results screen. */
export type ResultPayload = {
  registration_id: string;
  status: ResultStatus;
  finish_time: string | null; // "H:MM:SS" / "HH:MM:SS", required when status is "finished"
  position: number | null;
  dnf_reason: string | null;
  dsq_reason: string | null;
};

/**
 * Returns a Spanish error string if the payload is invalid, otherwise null.
 * Does not check position-uniqueness within a category — that's a
 * cross-row concern the caller checks against the full set of rows for the
 * stage (see `findDuplicatePositions`).
 */
export function validateResultPayload(payload: ResultPayload): string | null {
  if (!RESULT_STATUSES.includes(payload.status)) {
    return "El estado del resultado no es válido.";
  }
  if (payload.status === "dns") {
    return "El estado DNS se gestiona desde la inscripción del corredor.";
  }
  if (payload.status === "finished") {
    if (!payload.finish_time || parseTimeToSeconds(payload.finish_time) === null) {
      return "El tiempo de llegada es obligatorio y debe tener el formato H:MM:SS.";
    }
    if (
      payload.position !== null &&
      (!Number.isInteger(payload.position) || payload.position < 1)
    ) {
      return "La posición debe ser un número entero positivo.";
    }
  } else {
    // dnf / dsq: time and position are not applicable.
    if (payload.position !== null) {
      return "La posición no aplica para este estado.";
    }
  }
  return null;
}

/**
 * Given the full set of (category_id, position) pairs for a stage's
 * `finished` results, returns the set of registration ids whose position
 * collides with another row in the same category. Used both for inline
 * validation and to block "Mark stage as completed" on conflicts.
 */
export function findDuplicatePositions(
  rows: readonly { registration_id: string; category_id: string; position: number | null }[],
): Set<string> {
  const seen = new Map<string, string[]>(); // `${category_id}:${position}` -> registration_ids
  for (const row of rows) {
    if (row.position === null) continue;
    const key = `${row.category_id}:${row.position}`;
    const list = seen.get(key) ?? [];
    list.push(row.registration_id);
    seen.set(key, list);
  }
  const duplicates = new Set<string>();
  for (const ids of seen.values()) {
    if (ids.length > 1) {
      for (const id of ids) duplicates.add(id);
    }
  }
  return duplicates;
}

type Admin = ReturnType<typeof createAdminClient>;

export type UpsertResultResult =
  | { ok: true; result: { id: string; [key: string]: unknown } }
  | { ok: false; error: string };

/**
 * Upserts a single result row (keyed by the `unique (stage_id, registration_id)`
 * constraint). Computes `elapsed_seconds`/`net_seconds` from the parsed
 * finish time for `finished` results; clears time/position fields for
 * `dnf`/`dsq`. Caller is responsible for authorization and payload
 * validation (see `validateResultPayload`).
 */
export async function upsertResult(
  admin: Admin,
  stageId: string,
  payload: ResultPayload,
): Promise<UpsertResultResult> {
  const seconds =
    payload.status === "finished" && payload.finish_time
      ? parseTimeToSeconds(payload.finish_time)
      : null;

  const row = {
    stage_id: stageId,
    registration_id: payload.registration_id,
    status: payload.status,
    elapsed_seconds: payload.status === "finished" ? seconds : null,
    net_seconds: payload.status === "finished" ? seconds : null,
    position: payload.status === "finished" ? payload.position : null,
    finish_time: null as string | null,
    dnf_reason: payload.status === "dnf" ? payload.dnf_reason?.trim() || null : null,
    dsq_reason: payload.status === "dsq" ? payload.dsq_reason?.trim() || null : null,
    captured_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("results")
    .upsert(row, { onConflict: "stage_id,registration_id" })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: "No se pudo guardar el resultado. Inténtalo de nuevo." };
  }
  return { ok: true, result: data };
}

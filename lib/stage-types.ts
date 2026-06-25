import type { StageType } from "@/types/app";

/**
 * Shared stage-type metadata (Story 04). Used by the stage type selector
 * (buttons, not a dropdown) on the race management page, and by anything else
 * that needs a Spanish label for a stage type (start-order/results stories).
 */
export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  road: "Ruta",
  time_trial: "Contrarreloj",
  criterium: "Criterium",
  mountain: "Montaña",
  sprint: "Sprint",
};

export const STAGE_TYPE_DESCRIPTIONS: Record<StageType, string> = {
  road: "Etapa de ruta con salida masiva estándar.",
  time_trial: "Salida individual; los corredores compiten contra el reloj.",
  criterium: "Varias vueltas a un circuito corto.",
  mountain: "Etapa de ruta de alta montaña.",
  sprint: "Etapa corta, plana y de alta velocidad.",
};

export const STAGE_TYPES: readonly StageType[] = [
  "road",
  "time_trial",
  "criterium",
  "mountain",
  "sprint",
];

/** Shown inline only when "Contrarreloj" (time_trial) is selected. */
export const TIME_TRIAL_NOTE =
  "Esta etapa tendrá un orden de salida generado y seguimiento en vivo de CRI.";

export type StageDisplayStatus = "upcoming" | "live" | "completed";

export const STAGE_STATUS_LABELS: Record<StageDisplayStatus, string> = {
  upcoming: "Próxima",
  live: "En vivo",
  completed: "Finalizada",
};

/**
 * Derives the display status for a stage (Story 04).
 *
 * `hasResults` and `isLive` are passed in because they depend on data this
 * module doesn't own: results existence (Story 08/09) and an active live
 * tracking session (no `live_session` concept exists in the schema yet as of
 * Story 04 — later stories 15-22 introduce live tracking; pass `isLive` as
 * `false` until that table/flag exists, then wire it through here).
 */
export function deriveStageStatus(params: {
  hasResults: boolean;
  isLive: boolean;
}): StageDisplayStatus {
  if (params.isLive) return "live";
  if (params.hasResults) return "completed";
  return "upcoming";
}

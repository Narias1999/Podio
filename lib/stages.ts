import type { StageType } from "@/types/app";
import { STAGE_TYPES } from "@/lib/stage-types";

/**
 * Shared shapes/validation for the stages API (Story 04). Mirrors the
 * pattern in `lib/race-wizard.ts`: payload types + a validator reused by both
 * the client (to gate submit) and the server (to validate before writing).
 */

export type StagePayload = {
  name: string;
  date: string; // yyyy-MM-dd
  distance_km: number | null;
  stage_type: StageType;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a Spanish error string if the payload is invalid, otherwise null. */
export function validateStagePayload(payload: StagePayload): string | null {
  if (!payload.name?.trim()) {
    return "El nombre de la etapa es obligatorio.";
  }
  if (!payload.date || !DATE_RE.test(payload.date)) {
    return "La fecha de la etapa es obligatoria.";
  }
  if (
    payload.distance_km !== null &&
    (typeof payload.distance_km !== "number" ||
      Number.isNaN(payload.distance_km) ||
      payload.distance_km < 0)
  ) {
    return "La distancia debe ser un número positivo.";
  }
  if (!STAGE_TYPES.includes(payload.stage_type)) {
    return "Selecciona un tipo de etapa válido.";
  }
  return null;
}

export type ReorderPayload = {
  stage_ids: string[];
};

/** Returns a Spanish error string if the reorder payload is invalid. */
export function validateReorderPayload(
  payload: ReorderPayload,
  existingIds: readonly string[],
): string | null {
  if (!Array.isArray(payload.stage_ids) || payload.stage_ids.length === 0) {
    return "Solicitud de reordenamiento no válida.";
  }
  const existingSet = new Set(existingIds);
  const incomingSet = new Set(payload.stage_ids);
  if (
    incomingSet.size !== payload.stage_ids.length ||
    incomingSet.size !== existingSet.size ||
    ![...incomingSet].every((id) => existingSet.has(id))
  ) {
    return "El orden enviado no coincide con las etapas de la carrera.";
  }
  return null;
}

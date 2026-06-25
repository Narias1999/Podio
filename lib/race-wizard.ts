import type { Discipline, Sex } from "@/types/app";

/**
 * Shared shapes for the create-race wizard (Story 03). These describe the JSON
 * payload the client wizard POSTs to `POST /api/races`, plus a couple of helpers
 * for validation reused on both the client (to gate "next") and the server (to
 * validate input before writing).
 */

export type WizardCategory = {
  // local-only id used as React key and drag identity; not persisted
  key: string;
  name: string;
  age_min: number | null;
  age_max: number | null;
  sex: Sex | null;
};

export type CreateRacePayload = {
  name: string;
  location: string;
  starts_at: string; // yyyy-MM-dd
  ends_at: string | null; // yyyy-MM-dd or null
  description: string | null;
  banner_url: string | null;
  discipline: Discipline;
  is_multi_stage: boolean;
  status: "draft" | "published";
  categories: Array<{
    name: string;
    age_min: number | null;
    age_max: number | null;
    sex: Sex | null;
  }>;
};

/** True when step 1 required fields (name, location, start date) are all set. */
export function isBasicInfoComplete(fields: {
  name: string;
  location: string;
  starts_at: string;
}): boolean {
  return (
    fields.name.trim().length > 0 &&
    fields.location.trim().length > 0 &&
    fields.starts_at.trim().length > 0
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a Spanish error string if the payload is invalid, otherwise null. */
export function validateCreateRacePayload(
  payload: CreateRacePayload,
): string | null {
  if (!payload.name?.trim()) return "El nombre de la carrera es obligatorio.";
  if (!payload.location?.trim()) return "La ubicación es obligatoria.";
  if (!payload.starts_at || !DATE_RE.test(payload.starts_at)) {
    return "La fecha de inicio es obligatoria.";
  }
  if (payload.ends_at && !DATE_RE.test(payload.ends_at)) {
    return "La fecha de finalización no es válida.";
  }
  if (payload.ends_at && payload.ends_at < payload.starts_at) {
    return "La fecha de finalización no puede ser anterior a la de inicio.";
  }
  if (payload.discipline !== "cycling" && payload.discipline !== "running") {
    return "Selecciona una disciplina.";
  }
  if (typeof payload.is_multi_stage !== "boolean") {
    return "Selecciona un formato de carrera.";
  }
  if (payload.status !== "draft" && payload.status !== "published") {
    return "Estado de carrera no válido.";
  }
  if (!Array.isArray(payload.categories) || payload.categories.length === 0) {
    return "Agrega al menos una categoría.";
  }
  for (const cat of payload.categories) {
    if (!cat.name?.trim()) return "Cada categoría debe tener un nombre.";
    if (cat.sex && cat.sex !== "male" && cat.sex !== "female") {
      return "El sexo de la categoría no es válido.";
    }
    if (
      cat.age_min !== null &&
      (!Number.isInteger(cat.age_min) || cat.age_min < 0)
    ) {
      return "La edad mínima de la categoría no es válida.";
    }
    if (
      cat.age_max !== null &&
      (!Number.isInteger(cat.age_max) || cat.age_max < 0)
    ) {
      return "La edad máxima de la categoría no es válida.";
    }
    if (
      cat.age_min !== null &&
      cat.age_max !== null &&
      cat.age_min > cat.age_max
    ) {
      return "La edad mínima no puede ser mayor que la máxima.";
    }
  }
  return null;
}

import type { Category, Sex } from "@/types/app";

/**
 * Shared shapes/validation for the categories API (Story 05). Mirrors the
 * pattern in `lib/stages.ts`: payload types + a validator reused by both the
 * client (to gate submit) and the server (to validate before writing).
 */

export type CategoryPayload = {
  name: string;
  age_min: number | null;
  age_max: number | null;
  sex: Sex | null;
};

/**
 * Returns a Spanish error string if the payload is invalid, otherwise null.
 *
 * `existingNames` is the set of other category names already in the race
 * (trimmed, case-insensitive); pass the full list minus the category being
 * edited so renaming a category to its own current name doesn't self-collide.
 */
export function validateCategoryPayload(
  payload: CategoryPayload,
  existingNames: readonly string[] = [],
): string | null {
  if (!payload.name?.trim()) {
    return "El nombre de la categoría es obligatorio.";
  }
  const normalized = payload.name.trim().toLowerCase();
  if (existingNames.some((name) => name.trim().toLowerCase() === normalized)) {
    return "Ya existe una categoría con ese nombre en esta carrera.";
  }
  if (payload.sex !== null && payload.sex !== "male" && payload.sex !== "female") {
    return "El sexo de la categoría no es válido.";
  }
  if (
    payload.age_min !== null &&
    (!Number.isInteger(payload.age_min) || payload.age_min < 0)
  ) {
    return "La edad mínima no es válida.";
  }
  if (
    payload.age_max !== null &&
    (!Number.isInteger(payload.age_max) || payload.age_max < 0)
  ) {
    return "La edad máxima no es válida.";
  }
  if (
    payload.age_min !== null &&
    payload.age_max !== null &&
    payload.age_min > payload.age_max
  ) {
    return "La edad mínima no puede ser mayor que la máxima.";
  }
  return null;
}

export type ReorderCategoriesPayload = {
  category_ids: string[];
};

/** Returns a Spanish error string if the reorder payload is invalid. */
export function validateReorderCategoriesPayload(
  payload: ReorderCategoriesPayload,
  existingIds: readonly string[],
): string | null {
  if (
    !Array.isArray(payload.category_ids) ||
    payload.category_ids.length === 0
  ) {
    return "Solicitud de reordenamiento no válida.";
  }
  const existingSet = new Set(existingIds);
  const incomingSet = new Set(payload.category_ids);
  if (
    incomingSet.size !== payload.category_ids.length ||
    incomingSet.size !== existingSet.size ||
    ![...incomingSet].every((id) => existingSet.has(id))
  ) {
    return "El orden enviado no coincide con las categorías de la carrera.";
  }
  return null;
}

/**
 * Computes a rider's age in whole years at a given reference date (the
 * race's `starts_at`, per Story 01's auto-assignment rule).
 */
export function ageAt(dateOfBirth: string, referenceDate: string): number {
  const dob = new Date(dateOfBirth);
  const ref = new Date(referenceDate);
  let age = ref.getFullYear() - dob.getFullYear();
  const hadBirthdayYet =
    ref.getMonth() > dob.getMonth() ||
    (ref.getMonth() === dob.getMonth() && ref.getDate() >= dob.getDate());
  if (!hadBirthdayYet) age -= 1;
  return age;
}

/**
 * Suggests a category for a rider given their age (in years, at the race's
 * `starts_at` date) and sex, per Story 01's auto-assignment rule: a category
 * matches when the rider's age falls within its inclusive age_min/age_max
 * bounds (when set) and the rider's sex matches its sex restriction (when
 * set). Categories with no age/sex rules at all (manual-only) never match
 * automatically. When multiple categories match, the first by sort_order
 * wins. Returns `null` when nothing matches — the organizer must pick
 * manually.
 *
 * Used by registration (Story 06) to pre-select a category; the chosen
 * `category_id` is still stored on the registration and can be overridden.
 */
export function suggestCategory(
  categories: readonly Category[],
  rider: { age: number; sex: Sex },
): Category | null {
  const candidates = categories
    .filter((c) => c.age_min !== null || c.age_max !== null || c.sex !== null)
    .filter((c) => c.age_min === null || rider.age >= c.age_min)
    .filter((c) => c.age_max === null || rider.age <= c.age_max)
    .filter((c) => c.sex === null || c.sex === rider.sex)
    .sort((a, b) => a.sort_order - b.sort_order);

  return candidates[0] ?? null;
}

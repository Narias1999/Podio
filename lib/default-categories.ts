import type { Sex } from "@/types/app";

/**
 * Shared default category definitions used to pre-populate a new race's categories
 * (used by the race wizard in Stories 03/05). Each entry is a name plus optional
 * inclusive age bounds and/or a sex restriction. Age bounds are evaluated in years
 * against the rider's age at the race's `starts_at` date.
 *
 * Names are in Spanish (es-CO), matching the app's Spanish-only convention.
 * This list is the single source of truth for the wizard's preset chips and the
 * auto-populated default category set; keep it in sync with `supabase/seed.sql`.
 */
export type DefaultCategory = {
  name: string;
  age_min: number | null;
  age_max: number | null;
  sex: Sex | null;
};

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { name: "Infantil", age_min: null, age_max: 12, sex: null },
  { name: "Prejuvenil", age_min: 13, age_max: 14, sex: null },
  { name: "Juvenil", age_min: 15, age_max: 16, sex: null },
  { name: "Sub-23 Masculino", age_min: 17, age_max: 22, sex: "male" },
  { name: "Sub-23 Femenino", age_min: 17, age_max: 22, sex: "female" },
  { name: "Elite Masculino", age_min: 23, age_max: 29, sex: "male" },
  { name: "Elite Femenino", age_min: 23, age_max: 29, sex: "female" },
  { name: "Master 30+", age_min: 30, age_max: 39, sex: null },
  { name: "Master 40+", age_min: 40, age_max: 49, sex: null },
  { name: "Master 50+", age_min: 50, age_max: null, sex: null },
] as const;

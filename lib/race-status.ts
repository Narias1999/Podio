import type { Discipline, RaceStatus } from "@/types/app";

/** Spanish (es-CO) labels for race statuses, shown in dashboard/manage badges. */
export const RACE_STATUS_LABELS: Record<RaceStatus, string> = {
  draft: "Borrador",
  published: "Publicada",
  completed: "Finalizada",
};

/** Spanish (es-CO) labels for race disciplines. */
export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  cycling: "Ciclismo",
  running: "Atletismo",
};

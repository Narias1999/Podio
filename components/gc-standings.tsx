import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GcStandingsTable } from "@/components/gc-standings-table";
import type { GcStandings } from "@/lib/gc";

/**
 * Read-only General Classification card (Story 10, organizer view). Wraps the
 * shared `GcStandingsTable` (also used by the public results GC tab, Story 14)
 * in a card with a summary of how many stages are included.
 */
export function GcStandings({ standings }: { standings: GcStandings }) {
  const completedCount = standings.stages.length;

  if (completedCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Clasificación general</CardTitle>
          <CardDescription>
            La clasificación general aparecerá cuando se complete al menos una
            etapa.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clasificación general</CardTitle>
        <CardDescription>
          Suma acumulada de tiempos en {completedCount}{" "}
          {completedCount === 1 ? "etapa completada" : "etapas completadas"}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GcStandingsTable standings={standings} />
      </CardContent>
    </Card>
  );
}

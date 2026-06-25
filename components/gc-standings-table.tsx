import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RESULT_STATUS_LABELS } from "@/lib/results";
import type { GcStandings } from "@/lib/gc";

/**
 * Pure presentation of `computeGc` output, grouped by category: ranked riders
 * with total time + gap to leader, and a "No clasificados" list below.
 * Extracted from `gc-standings.tsx` so both the organizer GC card (Story 10)
 * and the public results GC tab (Story 14) render standings identically.
 *
 * Callers handle the "no completed stages" empty state and any surrounding
 * chrome (card/heading); this component only renders the category tables.
 */
export function GcStandingsTable({ standings }: { standings: GcStandings }) {
  if (standings.categories.length === 0) {
    return (
      <p className="text-center text-muted-foreground">
        No hay corredores inscritos.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {standings.categories.map((category) => (
        <div key={category.category_id} className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {category.category_name}
          </h3>

          {category.ranked.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ningún corredor ha completado todas las etapas en esta categoría.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Pos.</TableHead>
                  <TableHead className="w-16">Dorsal</TableHead>
                  <TableHead>Corredor</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead className="text-right">Tiempo total</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {category.ranked.map((rider) => (
                  <TableRow key={rider.registration_id}>
                    <TableCell className="font-medium">
                      {rider.position}
                    </TableCell>
                    <TableCell>
                      {rider.bib_number != null ? rider.bib_number : "—"}
                    </TableCell>
                    <TableCell>{rider.rider_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {rider.team ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rider.total_time}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {rider.gap_to_leader}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {category.nonFinishers.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                No clasificados
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Dorsal</TableHead>
                    <TableHead>Corredor</TableHead>
                    <TableHead>Equipo</TableHead>
                    <TableHead className="text-right">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {category.nonFinishers.map((rider) => (
                    <TableRow
                      key={rider.registration_id}
                      className="opacity-70"
                    >
                      <TableCell>
                        {rider.bib_number != null ? rider.bib_number : "—"}
                      </TableCell>
                      <TableCell>{rider.rider_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {rider.team ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">
                          {RESULT_STATUS_LABELS[rider.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

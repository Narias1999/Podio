import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
 * Read-only General Classification standings (Story 10, organizer view).
 * Renders the output of `computeGc` grouped by category: ranked riders with
 * total time and gap to leader, plus a separate "No clasificados" list for
 * riders excluded by a DNF/DSQ/DNS on any completed stage. Pure presentation
 * — it takes the already-computed `GcStandings` so the same data can later be
 * reused on the public results page (Story 14).
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
      <CardContent className="flex flex-col gap-8">
        {standings.categories.length === 0 ? (
          <p className="text-center text-muted-foreground">
            No hay corredores inscritos.
          </p>
        ) : (
          standings.categories.map((category) => (
            <div key={category.category_id} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {category.category_name}
              </h3>

              {category.ranked.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ningún corredor ha completado todas las etapas en esta
                  categoría.
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
          ))
        )}
      </CardContent>
    </Card>
  );
}

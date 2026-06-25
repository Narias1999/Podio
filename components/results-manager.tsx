"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  RESULT_STATUSES,
  RESULT_STATUS_LABELS,
  findDuplicatePositions,
  validateResultPayload,
  type ResultPayload,
} from "@/lib/results";
import { ResultsImportDialog } from "@/components/results-import-dialog";
import type { ResultStatus } from "@/types/app";

export type ResultRow = {
  registration_id: string;
  bib_number: number | null;
  rider_name: string;
  category_id: string;
  category_name: string;
  category_sort_order: number;
  registration_status: "confirmed" | "dns";
  status: ResultStatus;
  finish_time: string; // draft input value, "H:MM:SS"
  position: string; // draft input value
  dnf_reason: string;
  dsq_reason: string;
  saved: boolean;
  /**
   * Group-stage result saved without a net time because the rider's category
   * never recorded a start (Story 22). Surfaces a warning on this row.
   */
  missingStart?: boolean;
};

type Props = {
  slug: string;
  stageNumber: number;
  initialRows: ResultRow[];
  initialLocked: boolean;
};

function rowToPayload(row: ResultRow): ResultPayload {
  return {
    registration_id: row.registration_id,
    status: row.status,
    finish_time: row.status === "finished" ? row.finish_time.trim() || null : null,
    position:
      row.status === "finished" && row.position.trim() !== ""
        ? Number.parseInt(row.position, 10)
        : null,
    dnf_reason: row.status === "dnf" ? row.dnf_reason.trim() || null : null,
    dsq_reason: row.status === "dsq" ? row.dsq_reason.trim() || null : null,
  };
}

export function ResultsManager({
  slug,
  stageNumber,
  initialRows,
  initialLocked,
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<ResultRow[]>(initialRows);
  const [locked, setLocked] = useState(initialLocked);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savingId, setSavingId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; sortOrder: number; rows: ResultRow[] }>();
    for (const row of rows) {
      const entry = map.get(row.category_id);
      if (entry) {
        entry.rows.push(row);
      } else {
        map.set(row.category_id, {
          name: row.category_name,
          sortOrder: row.category_sort_order,
          rows: [row],
        });
      }
    }
    return [...map.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        ...g,
        rows: [...g.rows].sort((a, b) => {
          if (a.registration_status === "dns" && b.registration_status !== "dns") return 1;
          if (b.registration_status === "dns" && a.registration_status !== "dns") return -1;
          return (a.bib_number ?? 0) - (b.bib_number ?? 0);
        }),
      }));
  }, [rows]);

  const duplicatePositions = useMemo(() => {
    return findDuplicatePositions(
      rows
        .filter((r) => r.status === "finished" && r.position.trim() !== "")
        .map((r) => ({
          registration_id: r.registration_id,
          category_id: r.category_id,
          position: Number.parseInt(r.position, 10),
        })),
    );
  }, [rows]);

  // Bib → category id, so the CSV importer can validate bibs and check
  // position uniqueness within each category in its client-side preview.
  const bibCategories = useMemo(() => {
    const map: Record<number, string> = {};
    for (const row of rows) {
      if (row.bib_number != null) map[row.bib_number] = row.category_id;
    }
    return map;
  }, [rows]);

  const eligibleRows = useMemo(
    () => rows.filter((r) => r.registration_status !== "dns"),
    [rows],
  );
  const canMarkComplete =
    eligibleRows.length > 0 && eligibleRows.every((r) => r.saved);

  function updateRow(registrationId: string, patch: Partial<ResultRow>) {
    setRows((prev) =>
      prev.map((r) =>
        r.registration_id === registrationId
          ? { ...r, ...patch, saved: false }
          : r,
      ),
    );
    setErrors((prev) => {
      if (!(registrationId in prev)) return prev;
      const next = { ...prev };
      delete next[registrationId];
      return next;
    });
  }

  async function saveRow(row: ResultRow): Promise<boolean> {
    if (duplicatePositions.has(row.registration_id)) {
      setErrors((prev) => ({
        ...prev,
        [row.registration_id]: "La posición está duplicada dentro de la categoría.",
      }));
      return false;
    }
    const payload = rowToPayload(row);
    const validationError = validateResultPayload(payload);
    if (validationError) {
      setErrors((prev) => ({ ...prev, [row.registration_id]: validationError }));
      return false;
    }

    setSavingId(row.registration_id);
    try {
      const res = await fetch(
        `/api/races/${slug}/stages/${stageNumber}/results/${row.registration_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [row.registration_id]: data.error ?? "No se pudo guardar el resultado.",
        }));
        return false;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.registration_id === row.registration_id ? { ...r, saved: true } : r,
        ),
      );
      setErrors((prev) => {
        if (!(row.registration_id in prev)) return prev;
        const next = { ...prev };
        delete next[row.registration_id];
        return next;
      });
      return true;
    } catch {
      setErrors((prev) => ({
        ...prev,
        [row.registration_id]: "No se pudo guardar el resultado. Inténtalo de nuevo.",
      }));
      return false;
    } finally {
      setSavingId(null);
    }
  }

  function handleBlurSave(row: ResultRow) {
    if (locked || row.registration_status === "dns" || row.saved) return;
    startTransition(async () => {
      await saveRow(row);
    });
  }

  function saveAll() {
    startTransition(async () => {
      const unsaved = rows.filter(
        (r) => r.registration_status !== "dns" && !r.saved,
      );
      if (unsaved.length === 0) {
        toast.message("No hay cambios sin guardar.");
        return;
      }
      let successCount = 0;
      for (const row of unsaved) {
        const ok = await saveRow(row);
        if (ok) successCount += 1;
      }
      if (successCount === unsaved.length) {
        toast.success("Todos los resultados se guardaron.");
      } else {
        toast.error(
          `${successCount} de ${unsaved.length} resultados se guardaron. Revisa los errores.`,
        );
      }
    });
  }

  function markComplete() {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/stages/${stageNumber}/complete`,
          { method: "POST" },
        );
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo completar la etapa.");
          return;
        }
        setLocked(true);
        toast.success("Etapa marcada como completada.");
      } catch {
        toast.error("No se pudo completar la etapa. Inténtalo de nuevo.");
      }
    });
  }

  function unlock() {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/stages/${stageNumber}/complete`,
          { method: "DELETE" },
        );
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo desbloquear la etapa.");
          return;
        }
        setLocked(false);
        toast.success("Resultados desbloqueados.");
        setUnlockOpen(false);
      } catch {
        toast.error("No se pudo desbloquear la etapa. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Resultados</CardTitle>
            <CardDescription>
              {rows.length} corredores
              {locked ? " — resultados bloqueados" : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {locked ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setUnlockOpen(true)}
                disabled={pending}
              >
                Desbloquear resultados
              </Button>
            ) : (
              <>
                <ResultsImportDialog
                  slug={slug}
                  stageNumber={stageNumber}
                  bibCategories={bibCategories}
                  onImported={() => router.refresh()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={saveAll}
                  disabled={pending}
                >
                  Guardar todo
                </Button>
                {canMarkComplete && (
                  <Button type="button" onClick={markComplete} disabled={pending}>
                    Marcar etapa como completada
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {grouped.length === 0 ? (
          <p className="text-center text-muted-foreground">
            No hay corredores confirmados para esta carrera.
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.name} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {group.name}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dorsal</TableHead>
                    <TableHead>Corredor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Tiempo</TableHead>
                    <TableHead>Posición</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Guardado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => {
                    const isDns = row.registration_status === "dns";
                    const disabledTimePos =
                      isDns || row.status === "dnf" || row.status === "dsq";
                    const rowError = errors[row.registration_id];
                    const hasDuplicate = duplicatePositions.has(row.registration_id);
                    return (
                      <TableRow
                        key={row.registration_id}
                        className={cn(isDns && "opacity-60")}
                      >
                        <TableCell className="font-medium">
                          {row.bib_number != null ? row.bib_number : "—"}
                        </TableCell>
                        <TableCell>{row.rider_name}</TableCell>
                        <TableCell>
                          {isDns ? (
                            <Badge variant="secondary">DNS</Badge>
                          ) : (
                            <Select
                              value={row.status}
                              onValueChange={(v) =>
                                updateRow(row.registration_id, {
                                  status: v as ResultStatus,
                                })
                              }
                              disabled={locked || pending}
                            >
                              <SelectTrigger className="w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {RESULT_STATUSES.filter((s) => s !== "dns").map(
                                  (s) => (
                                    <SelectItem key={s} value={s}>
                                      {RESULT_STATUS_LABELS[s]}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            placeholder="ej. 3:42:15"
                            className="w-28"
                            value={row.finish_time}
                            onChange={(e) =>
                              updateRow(row.registration_id, {
                                finish_time: e.target.value,
                              })
                            }
                            onBlur={() => handleBlurSave(row)}
                            disabled={locked || disabledTimePos || pending}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            className={cn("w-20", hasDuplicate && "border-destructive")}
                            value={row.position}
                            onChange={(e) =>
                              updateRow(row.registration_id, {
                                position: e.target.value,
                              })
                            }
                            onBlur={() => handleBlurSave(row)}
                            disabled={locked || disabledTimePos || pending}
                          />
                        </TableCell>
                        <TableCell>
                          {(row.status === "dnf" || row.status === "dsq") && (
                            <Input
                              placeholder="Motivo (opcional)"
                              className="w-40"
                              value={
                                row.status === "dnf" ? row.dnf_reason : row.dsq_reason
                              }
                              onChange={(e) =>
                                updateRow(
                                  row.registration_id,
                                  row.status === "dnf"
                                    ? { dnf_reason: e.target.value }
                                    : { dsq_reason: e.target.value },
                                )
                              }
                              onBlur={() => handleBlurSave(row)}
                              disabled={locked || pending}
                            />
                          )}
                          {rowError && (
                            <p className="mt-1 text-xs text-destructive" role="alert">
                              {rowError}
                            </p>
                          )}
                          {!rowError && hasDuplicate && (
                            <p className="mt-1 text-xs text-destructive" role="alert">
                              Posición duplicada en la categoría.
                            </p>
                          )}
                          {row.missingStart && (
                            <p
                              className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-500"
                              role="alert"
                            >
                              <TriangleAlert
                                className="mt-0.5 size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span>
                                No se registró la hora de salida de esta
                                categoría — no se puede calcular el tiempo neto.
                              </span>
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isDns ? (
                            "—"
                          ) : row.saved ? (
                            <Check className="ml-auto size-4 text-primary" />
                          ) : savingId === row.registration_id ? (
                            <span className="text-xs text-muted-foreground">
                              Guardando…
                            </span>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                startTransition(async () => {
                                  await saveRow(row);
                                })
                              }
                              disabled={locked || pending}
                            >
                              Guardar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ))
        )}
      </CardContent>

      <AlertDialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desbloquear los resultados?</AlertDialogTitle>
            <AlertDialogDescription>
              Podrás volver a editar los resultados de esta etapa. Esto puede
              afectar la clasificación general si la carrera ya tiene más
              etapas completadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={unlock}>Desbloquear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { GripVertical, Undo2 } from "lucide-react";

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
import { Label } from "@/components/ui/label";
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
  DEFAULT_START_ORDER_CONFIG,
  validateStartOrderConfig,
  type StartOrderConfig,
} from "@/lib/tt-start-order";

export type StartOrderRow = {
  registration_id: string;
  position: number;
  start_time: string | null;
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  category_id: string;
  category_name: string;
};

type Props = {
  slug: string;
  stageNumber: number;
  initialRows: StartOrderRow[];
  locked: boolean;
};

function formatStartTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm:ss", { locale: es });
}

export function StartOrderManager({
  slug,
  stageNumber,
  initialRows,
  locked,
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<StartOrderRow[]>(initialRows);
  const hasOrder = initialRows.length > 0;

  const [interval, setInterval] = useState(
    String(DEFAULT_START_ORDER_CONFIG.intervalSeconds),
  );
  const [gap, setGap] = useState(
    String(DEFAULT_START_ORDER_CONFIG.categoryGapSeconds),
  );
  const [firstStart, setFirstStart] = useState(
    DEFAULT_START_ORDER_CONFIG.firstStartTime,
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [dragId, setDragId] = useState<string | null>(null);
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);
  const [undoRows, setUndoRows] = useState<StartOrderRow[] | null>(null);
  const [reordering, setReordering] = useState(false);

  function persistReorder(
    registrationId: string,
    toIndex: number,
    previousRows: StartOrderRow[],
  ) {
    setReordering(true);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/stages/${stageNumber}/start-order/reorder`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registration_id: registrationId,
              to_index: toIndex,
            }),
          },
        );
        const data = (await res.json()) as {
          entries?: StartOrderRow[];
          error?: string;
        };
        if (!res.ok || !data.entries) {
          toast.error(data.error ?? "No se pudo reordenar el orden de salida.");
          setRows(previousRows);
          setReordering(false);
          return;
        }
        setRows(data.entries);
        setUndoRows(previousRows);
        setReordering(false);
      } catch {
        toast.error("No se pudo reordenar el orden de salida. Inténtalo de nuevo.");
        setRows(previousRows);
        setReordering(false);
      }
    });
  }

  function handleDrop(targetId: string) {
    if (dragId === null || dragId === targetId) {
      setDragId(null);
      return;
    }

    const moving = rows.find((r) => r.registration_id === dragId);
    const target = rows.find((r) => r.registration_id === targetId);
    setDragId(null);

    if (!moving || !target) return;

    if (moving.category_id !== target.category_id) {
      setRejectMessage(
        "Solo se puede reordenar dentro de la misma categoría.",
      );
      window.setTimeout(() => setRejectMessage(null), 4000);
      return;
    }

    const previousRows = rows;
    const categoryRows = rows.filter(
      (r) => r.category_id === moving.category_id,
    );
    const toIndexInCategory = categoryRows.findIndex(
      (r) => r.registration_id === targetId,
    );

    persistReorder(dragId, toIndexInCategory, previousRows);
  }

  function handleUndo() {
    if (!undoRows) return;
    const toRestore = undoRows;
    const previousRows = rows;
    setUndoRows(null);
    // Replay the undo as a real reorder so the server stays the source of
    // truth: move every rider back to their pre-drag index within their
    // category, one move per affected rider (only ones whose position
    // actually differs need a request).
    const moved = toRestore.find((restoredRow, idx) => {
      const current = previousRows[idx];
      return current && current.registration_id !== restoredRow.registration_id;
    });
    if (!moved) {
      setRows(toRestore);
      return;
    }
    const categoryRows = toRestore.filter(
      (r) => r.category_id === moved.category_id,
    );
    const toIndexInCategory = categoryRows.findIndex(
      (r) => r.registration_id === moved.registration_id,
    );
    persistReorder(moved.registration_id, toIndexInCategory, previousRows);
  }

  function buildConfig(): StartOrderConfig {
    return {
      intervalSeconds: Number.parseInt(interval, 10),
      categoryGapSeconds: Number.parseInt(gap, 10),
      firstStartTime: firstStart.length === 5 ? `${firstStart}:00` : firstStart,
    };
  }

  function generate() {
    const config = buildConfig();
    const error = validateStartOrderConfig(config);
    if (error) {
      toast.error(error);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/stages/${stageNumber}/start-order`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
          },
        );
        const data = (await res.json()) as { error?: string; usedGc?: boolean };
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo generar el orden de salida.");
          return;
        }
        toast.success(
          data.usedGc
            ? "Orden de salida generado (inverso a la clasificación general)."
            : "Orden de salida generado (orden aleatorio).",
        );
        setConfirmOpen(false);
        router.refresh();
      } catch {
        toast.error("No se pudo generar el orden de salida. Inténtalo de nuevo.");
      }
    });
  }

  function handleGenerateClick() {
    if (hasOrder) {
      setConfirmOpen(true);
    } else {
      generate();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
          <CardDescription>
            Define los intervalos y la hora de salida del primer corredor antes
            de generar el orden.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="interval">Intervalo entre corredores (s)</Label>
              <Input
                id="interval"
                type="number"
                inputMode="numeric"
                min={1}
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="gap">Intervalo entre categorías (s)</Label>
              <Input
                id="gap"
                type="number"
                inputMode="numeric"
                min={0}
                value={gap}
                onChange={(e) => setGap(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="first-start">Hora del primer corredor</Label>
              <Input
                id="first-start"
                type="time"
                step={1}
                value={firstStart}
                onChange={(e) => setFirstStart(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <div>
            <Button type="button" onClick={handleGenerateClick} disabled={pending}>
              {hasOrder ? "Regenerar orden de salida" : "Generar orden de salida"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {hasOrder && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <CardTitle>Orden de salida</CardTitle>
                <CardDescription>
                  {locked
                    ? `${rows.length} corredores`
                    : `${rows.length} corredores · arrastra para reordenar dentro de cada categoría`}
                </CardDescription>
              </div>
              {!locked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleUndo}
                  disabled={!undoRows || reordering}
                >
                  <Undo2 className="size-4" />
                  Deshacer
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {locked && (
              <p
                role="status"
                className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
              >
                La etapa ya inició — el orden de salida está bloqueado.
              </p>
            )}
            {rejectMessage && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {rejectMessage}
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  {!locked && <TableHead className="w-10" aria-hidden />}
                  <TableHead className="w-16">Pos.</TableHead>
                  <TableHead>Hora</TableHead>
                  <TableHead>Dorsal</TableHead>
                  <TableHead>Corredor</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Categoría</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const draggable = !locked && !reordering;
                  return (
                    <TableRow
                      key={row.registration_id}
                      draggable={draggable}
                      onDragStart={
                        draggable
                          ? () => setDragId(row.registration_id)
                          : undefined
                      }
                      onDragEnd={() => setDragId(null)}
                      onDragOver={
                        draggable ? (e) => e.preventDefault() : undefined
                      }
                      onDrop={
                        draggable
                          ? () => handleDrop(row.registration_id)
                          : undefined
                      }
                      className={cn(
                        !locked && "cursor-grab",
                        dragId === row.registration_id && "opacity-50",
                      )}
                    >
                      {!locked && (
                        <TableCell className="text-muted-foreground">
                          <GripVertical className="size-4" aria-hidden />
                        </TableCell>
                      )}
                      <TableCell className="font-medium">
                        {row.position}
                      </TableCell>
                      <TableCell>{formatStartTime(row.start_time)}</TableCell>
                      <TableCell>
                        {row.bib_number != null ? row.bib_number : "—"}
                      </TableCell>
                      <TableCell>{row.rider_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.team ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.category_name}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Regenerar el orden de salida?</AlertDialogTitle>
            <AlertDialogDescription>
              Se generará un nuevo orden de salida con la configuración actual.
              Cualquier reordenamiento manual que hayas hecho se perderá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={generate} disabled={pending}>
              Regenerar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

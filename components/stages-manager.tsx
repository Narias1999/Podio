"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { format, parse } from "date-fns";
import { es } from "date-fns/locale";
import { GripVertical, Plus, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  STAGE_STATUS_LABELS,
  STAGE_TYPES,
  STAGE_TYPE_DESCRIPTIONS,
  STAGE_TYPE_LABELS,
  TIME_TRIAL_NOTE,
  deriveStageStatus,
} from "@/lib/stage-types";
import type { Stage, StageType } from "@/types/app";

const ISO_DATE = "yyyy-MM-dd";

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const d = parse(iso, ISO_DATE, new Date());
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dateToIso(date: Date | undefined): string {
  return date ? format(date, ISO_DATE) : "";
}

function formatHuman(iso: string): string {
  const d = isoToDate(iso);
  return d ? format(d, "PPP", { locale: es }) : "";
}

type StageDraft = {
  name: string;
  date: string;
  distance_km: string; // raw input value
  stage_type: StageType;
};

function stageToDraft(stage: Stage): StageDraft {
  return {
    name: stage.name,
    date: stage.date,
    distance_km: stage.distance_km != null ? String(stage.distance_km) : "",
    stage_type: stage.stage_type as StageType,
  };
}

function blankDraft(date: string): StageDraft {
  return { name: "", date, distance_km: "", stage_type: "road" };
}

function parseDistance(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number.parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

type Props = {
  slug: string;
  initialStages: Stage[];
  isMultiStage: boolean;
  stagesWithResults: Set<string>;
};

export function StagesManager({
  slug,
  initialStages,
  isMultiStage,
  stagesWithResults,
}: Props) {
  const [stages, setStages] = useState<Stage[]>(initialStages);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StageDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<StageDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Stage | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit(stage: Stage) {
    setError(null);
    setEditingId(stage.id);
    setDraft(stageToDraft(stage));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function saveEdit(stage: Stage) {
    if (!draft) return;
    setError(null);

    const payload = {
      name: draft.name.trim(),
      date: draft.date,
      distance_km: parseDistance(draft.distance_km),
      stage_type: draft.stage_type,
    };

    if (!payload.name) {
      setError("El nombre de la etapa es obligatorio.");
      return;
    }
    if (!payload.date) {
      setError("La fecha de la etapa es obligatoria.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/stages/${stage.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const data = (await res.json()) as { stage?: Stage; error?: string };
        if (!res.ok || !data.stage) {
          setError(data.error ?? "No se pudo actualizar la etapa.");
          return;
        }
        setStages((prev) =>
          prev.map((s) => (s.id === stage.id ? data.stage! : s)),
        );
        toast.success("Etapa actualizada.");
        cancelEdit();
      } catch {
        setError("No se pudo actualizar la etapa. Inténtalo de nuevo.");
      }
    });
  }

  function startAdd() {
    setError(null);
    setAdding(true);
    const fallbackDate = stages[stages.length - 1]?.date ?? "";
    setAddDraft(blankDraft(fallbackDate));
  }

  function cancelAdd() {
    setAdding(false);
    setAddDraft(null);
  }

  function submitAdd() {
    if (!addDraft) return;
    setError(null);

    const payload = {
      name: addDraft.name.trim(),
      date: addDraft.date,
      distance_km: parseDistance(addDraft.distance_km),
      stage_type: addDraft.stage_type,
    };

    if (!payload.name) {
      setError("El nombre de la etapa es obligatorio.");
      return;
    }
    if (!payload.date) {
      setError("La fecha de la etapa es obligatoria.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/stages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { stage?: Stage; error?: string };
        if (!res.ok || !data.stage) {
          setError(data.error ?? "No se pudo crear la etapa.");
          return;
        }
        setStages((prev) => [...prev, data.stage!]);
        toast.success("Etapa agregada.");
        cancelAdd();
      } catch {
        setError("No se pudo crear la etapa. Inténtalo de nuevo.");
      }
    });
  }

  function requestDelete(stage: Stage) {
    setError(null);
    if (stagesWithResults.has(stage.id)) {
      toast.error(
        "No se puede eliminar esta etapa porque ya tiene resultados registrados.",
      );
      return;
    }
    if (stages.length <= 1) {
      toast.error("La carrera debe tener al menos una etapa.");
      return;
    }
    setDeleteTarget(stage);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const stage = deleteTarget;
    setDeleteTarget(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/stages/${stage.id}`, {
          method: "DELETE",
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo eliminar la etapa.");
          return;
        }
        // Refetch to get the renumbered stage list from the server.
        const listRes = await fetch(`/api/races/${slug}/stages`);
        const listData = (await listRes.json()) as { stages?: Stage[] };
        setStages(listData.stages ?? stages.filter((s) => s.id !== stage.id));
        toast.success("Etapa eliminada.");
      } catch {
        toast.error("No se pudo eliminar la etapa. Inténtalo de nuevo.");
      }
    });
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setStages(next);
  }

  function persistOrder() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/stages/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage_ids: stages.map((s) => s.id) }),
        });
        const data = (await res.json()) as {
          stages?: Stage[];
          error?: string;
        };
        if (!res.ok || !data.stages) {
          toast.error(data.error ?? "No se pudo reordenar las etapas.");
          return;
        }
        setStages(data.stages);
      } catch {
        toast.error("No se pudo reordenar las etapas. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Etapas</CardTitle>
        <CardDescription>
          {isMultiStage
            ? "Agrega, edita, reordena y elimina las etapas de la carrera."
            : "Configura el nombre, fecha, distancia y tipo de la etapa única."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {stages.map((stage, index) => {
          const status = deriveStageStatus({
            hasResults: stagesWithResults.has(stage.id),
            isLive: false,
          });
          const isEditing = editingId === stage.id;

          return (
            <div
              key={stage.id}
              draggable={isMultiStage && !isEditing}
              onDragStart={() => isMultiStage && setDragIndex(index)}
              onDragOver={(e) => {
                if (!isMultiStage) return;
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) {
                  reorder(dragIndex, index);
                  setDragIndex(index);
                }
              }}
              onDragEnd={() => {
                if (!isMultiStage) return;
                setDragIndex(null);
                persistOrder();
              }}
              className={cn(
                "flex flex-col gap-3 rounded-lg border bg-card p-3",
                dragIndex === index && "opacity-60",
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex flex-1 items-start gap-3">
                  {isMultiStage && (
                    <div
                      className="mt-1 flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
                      aria-label="Reordenar etapa"
                    >
                      <GripVertical className="size-5" />
                    </div>
                  )}

                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      Etapa {stage.stage_number}
                    </span>
                    <Badge
                      variant={
                        status === "live"
                          ? "default"
                          : status === "completed"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {STAGE_STATUS_LABELS[status]}
                    </Badge>
                  </div>

                  {isEditing && draft ? (
                    <StageForm
                      draft={draft}
                      onChange={setDraft}
                      idPrefix={`stage-${stage.id}`}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-medium">{stage.name}</span>
                      <span className="text-muted-foreground">
                        {formatHuman(stage.date)}
                      </span>
                      {stage.distance_km != null && (
                        <span className="text-muted-foreground">
                          {stage.distance_km} km
                        </span>
                      )}
                      <Badge variant="outline">
                        {STAGE_TYPE_LABELS[stage.stage_type as StageType]}
                      </Badge>
                    </div>
                  )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1 sm:justify-end">
                  {isEditing ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => saveEdit(stage)}
                        disabled={pending}
                      >
                        Guardar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={cancelEdit}
                        disabled={pending}
                      >
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      {stage.stage_type === "time_trial" && (
                        <Button asChild type="button" size="sm" variant="outline">
                          <Link
                            href={`/races/${slug}/manage/stages/${stage.stage_number}/start-order`}
                          >
                            Orden de salida
                          </Link>
                        </Button>
                      )}
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link
                          href={`/races/${slug}/manage/stages/${stage.stage_number}/results`}
                        >
                          Resultados
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(stage)}
                        disabled={pending}
                      >
                        Editar
                      </Button>
                      {isMultiStage && (
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Eliminar etapa"
                          onClick={() => requestDelete(stage)}
                          disabled={pending}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {isEditing && error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        })}

        {isMultiStage && (
          <>
            {adding && addDraft ? (
              <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-card p-3">
                <span className="text-sm font-medium text-muted-foreground">
                  Nueva etapa
                </span>
                <StageForm
                  draft={addDraft}
                  onChange={setAddDraft}
                  idPrefix="stage-new"
                />
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={submitAdd}
                    disabled={pending}
                  >
                    Agregar etapa
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={cancelAdd}
                    disabled={pending}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={startAdd}
                disabled={pending}
                className="self-start"
              >
                <Plus className="size-4" />
                Agregar etapa
              </Button>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta etapa?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Se eliminará "${deleteTarget.name}". Esta acción no se puede deshacer.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function StageForm({
  draft,
  onChange,
  idPrefix,
}: {
  draft: StageDraft;
  onChange: (next: StageDraft) => void;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = isoToDate(draft.date);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-name`} className="text-xs">
            Nombre
          </Label>
          <Input
            id={`${idPrefix}-name`}
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="Ej: Etapa 3 – Contrarreloj de montaña"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-date`} className="text-xs">
            Fecha
          </Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id={`${idPrefix}-date`}
                type="button"
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !selectedDate && "text-muted-foreground",
                )}
              >
                {selectedDate ? (
                  formatHuman(draft.date)
                ) : (
                  <span>Selecciona una fecha</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                locale={es}
                selected={selectedDate}
                defaultMonth={selectedDate}
                onSelect={(d) => {
                  onChange({ ...draft, date: dateToIso(d) });
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-distance`} className="text-xs">
            Distancia (km)
          </Label>
          <Input
            id={`${idPrefix}-distance`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={draft.distance_km}
            onChange={(e) =>
              onChange({ ...draft, distance_km: e.target.value })
            }
            placeholder="Opcional"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs">Tipo de etapa</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {STAGE_TYPES.map((type) => {
            const active = draft.stage_type === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onChange({ ...draft, stage_type: type })}
                aria-pressed={active}
                className={cn(
                  "flex flex-col gap-0.5 rounded-lg border-2 p-2.5 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted",
                )}
              >
                <span className="text-sm font-medium">
                  {STAGE_TYPE_LABELS[type]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {STAGE_TYPE_DESCRIPTIONS[type]}
                </span>
              </button>
            );
          })}
        </div>
        {draft.stage_type === "time_trial" && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {TIME_TRIAL_NOTE}
          </p>
        )}
      </div>
    </div>
  );
}

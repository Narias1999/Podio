"use client";

import { useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { validateCategoryPayload, type CategoryPayload } from "@/lib/categories";
import { DEFAULT_CATEGORIES, type DefaultCategory } from "@/lib/default-categories";
import type { Category, Sex } from "@/types/app";

// "any" is the sentinel for "no sex restriction" used by the Select (Radix
// Select items cannot have an empty-string value).
const SEX_ANY = "any";

type CategoryDraft = {
  name: string;
  age_min: string; // raw input value
  age_max: string; // raw input value
  sex: Sex | null;
};

function categoryToDraft(category: Category): CategoryDraft {
  return {
    name: category.name,
    age_min: category.age_min != null ? String(category.age_min) : "",
    age_max: category.age_max != null ? String(category.age_max) : "",
    sex: (category.sex as Sex | null) ?? null,
  };
}

function blankDraft(): CategoryDraft {
  return { name: "", age_min: "", age_max: "", sex: null };
}

function presetToDraft(preset: DefaultCategory): CategoryDraft {
  return {
    name: preset.name,
    age_min: preset.age_min != null ? String(preset.age_min) : "",
    age_max: preset.age_max != null ? String(preset.age_max) : "",
    sex: preset.sex,
  };
}

function parseAge(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function draftToPayload(draft: CategoryDraft): CategoryPayload {
  return {
    name: draft.name.trim(),
    age_min: parseAge(draft.age_min),
    age_max: parseAge(draft.age_max),
    sex: draft.sex,
  };
}

function formatRule(category: Category): string {
  const parts: string[] = [];
  if (category.age_min != null || category.age_max != null) {
    if (category.age_min != null && category.age_max != null) {
      parts.push(`${category.age_min}–${category.age_max} años`);
    } else if (category.age_min != null) {
      parts.push(`${category.age_min}+ años`);
    } else {
      parts.push(`hasta ${category.age_max} años`);
    }
  }
  if (category.sex === "male") parts.push("Masculino");
  if (category.sex === "female") parts.push("Femenino");
  return parts.length > 0 ? parts.join(" · ") : "Sin regla de edad/sexo";
}

type Props = {
  slug: string;
  initialCategories: Category[];
  categoriesWithRegistrations: Map<string, number>;
};

export function CategoriesManager({
  slug,
  initialCategories,
  categoriesWithRegistrations,
}: Props) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<CategoryDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit(category: Category) {
    setError(null);
    setEditingId(category.id);
    setDraft(categoryToDraft(category));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function saveEdit(category: Category) {
    if (!draft) return;
    setError(null);

    const payload = draftToPayload(draft);
    const existingNames = categories
      .filter((c) => c.id !== category.id)
      .map((c) => c.name);
    const validationError = validateCategoryPayload(payload, existingNames);
    if (validationError) {
      setError(validationError);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/categories/${category.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const data = (await res.json()) as {
          category?: Category;
          error?: string;
        };
        if (!res.ok || !data.category) {
          setError(data.error ?? "No se pudo actualizar la categoría.");
          return;
        }
        setCategories((prev) =>
          prev.map((c) => (c.id === category.id ? data.category! : c)),
        );
        toast.success("Categoría actualizada.");
        cancelEdit();
      } catch {
        setError("No se pudo actualizar la categoría. Inténtalo de nuevo.");
      }
    });
  }

  function startAdd() {
    setError(null);
    setAdding(true);
    setAddDraft(blankDraft());
  }

  function cancelAdd() {
    setAdding(false);
    setAddDraft(null);
  }

  function submitDraft(
    payload: CategoryPayload,
    onError: (message: string) => void,
  ) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          category?: Category;
          error?: string;
        };
        if (!res.ok || !data.category) {
          onError(data.error ?? "No se pudo crear la categoría.");
          return;
        }
        setCategories((prev) => [...prev, data.category!]);
        toast.success("Categoría agregada.");
        cancelAdd();
      } catch {
        onError("No se pudo crear la categoría. Inténtalo de nuevo.");
      }
    });
  }

  function submitAdd() {
    if (!addDraft) return;
    setError(null);

    const payload = draftToPayload(addDraft);
    const validationError = validateCategoryPayload(
      payload,
      categories.map((c) => c.name),
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    submitDraft(payload, setError);
  }

  function addPreset(preset: DefaultCategory) {
    setError(null);
    setAdding(false);
    setAddDraft(null);
    submitDraft(draftToPayload(presetToDraft(preset)), (message) =>
      toast.error(message),
    );
  }

  function requestDelete(category: Category) {
    setError(null);
    const count = categoriesWithRegistrations.get(category.id) ?? 0;
    if (count > 0) {
      toast.error(
        `Esta categoría tiene ${count} corredores inscritos. Elimínalos primero antes de eliminar la categoría.`,
      );
      return;
    }
    setDeleteTarget(category);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const category = deleteTarget;
    setDeleteTarget(null);

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/categories/${category.id}`,
          { method: "DELETE" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo eliminar la categoría.");
          return;
        }
        setCategories((prev) => prev.filter((c) => c.id !== category.id));
        toast.success("Categoría eliminada.");
      } catch {
        toast.error("No se pudo eliminar la categoría. Inténtalo de nuevo.");
      }
    });
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCategories(next);
  }

  function persistOrder() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/categories/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_ids: categories.map((c) => c.id),
          }),
        });
        const data = (await res.json()) as {
          categories?: Category[];
          error?: string;
        };
        if (!res.ok || !data.categories) {
          toast.error(data.error ?? "No se pudo reordenar las categorías.");
          return;
        }
        setCategories(data.categories);
      } catch {
        toast.error("No se pudo reordenar las categorías. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categorías</CardTitle>
        <CardDescription>
          Agrega, edita, reordena y elimina las categorías de la carrera.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Las categorías al inicio de esta lista salen primero en las
          contrarreloj. Coloca tu categoría más lenta primero.
        </p>

        {categories.map((category, index) => {
          const isEditing = editingId === category.id;
          const registrationCount =
            categoriesWithRegistrations.get(category.id) ?? 0;

          return (
            <div
              key={category.id}
              draggable={!isEditing}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) {
                  reorder(dragIndex, index);
                  setDragIndex(index);
                }
              }}
              onDragEnd={() => {
                setDragIndex(null);
                persistOrder();
              }}
              className={cn(
                "flex flex-col gap-3 rounded-lg border bg-card p-3",
                dragIndex === index && "opacity-60",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className="mt-1 flex cursor-grab items-center text-muted-foreground active:cursor-grabbing"
                  aria-label="Reordenar categoría"
                >
                  <GripVertical className="size-5" />
                </div>

                <div className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      Posición {index + 1}
                    </span>
                    {registrationCount > 0 && (
                      <Badge variant="secondary">
                        {registrationCount} inscritos
                      </Badge>
                    )}
                  </div>

                  {isEditing && draft ? (
                    <CategoryForm
                      draft={draft}
                      onChange={setDraft}
                      idPrefix={`category-${category.id}`}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-medium">{category.name}</span>
                      <span className="text-muted-foreground">
                        {formatRule(category)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => saveEdit(category)}
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
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(category)}
                        disabled={pending}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Eliminar categoría"
                        onClick={() => requestDelete(category)}
                        disabled={pending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isEditing && (
                <p className="text-xs text-muted-foreground">
                  Cambiar la regla de edad/sexo no reasigna a los corredores
                  ya inscritos; solo afecta las nuevas inscripciones.
                </p>
              )}

              {isEditing && error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        })}

        {adding && addDraft ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-card p-3">
            <span className="text-sm font-medium text-muted-foreground">
              Nueva categoría
            </span>
            <CategoryForm
              draft={addDraft}
              onChange={setAddDraft}
              idPrefix="category-new"
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
                Agregar categoría
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
            Agregar categoría
          </Button>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Accesos rápidos</p>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_CATEGORIES.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => addPreset(preset)}
                disabled={pending}
                className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Badge variant="outline" className="hover:bg-muted">
                  <Plus className="size-3" />
                  {preset.name}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      </CardContent>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta categoría?</AlertDialogTitle>
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

function CategoryForm({
  draft,
  onChange,
  idPrefix,
}: {
  draft: CategoryDraft;
  onChange: (next: CategoryDraft) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs">
          Nombre
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Ej: Elite Masculino"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-age-min`} className="text-xs">
          Edad mín.
        </Label>
        <Input
          id={`${idPrefix}-age-min`}
          type="number"
          inputMode="numeric"
          min={0}
          value={draft.age_min}
          onChange={(e) => onChange({ ...draft, age_min: e.target.value })}
          placeholder="Opcional"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-age-max`} className="text-xs">
          Edad máx.
        </Label>
        <Input
          id={`${idPrefix}-age-max`}
          type="number"
          inputMode="numeric"
          min={0}
          value={draft.age_max}
          onChange={(e) => onChange({ ...draft, age_max: e.target.value })}
          placeholder="Opcional"
        />
      </div>

      <div className="flex flex-col gap-1 sm:col-span-4">
        <Label className="text-xs">Sexo</Label>
        <Select
          value={draft.sex ?? SEX_ANY}
          onValueChange={(value) =>
            onChange({
              ...draft,
              sex: value === SEX_ANY ? null : (value as Sex),
            })
          }
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEX_ANY}>Cualquiera</SelectItem>
            <SelectItem value="male">Masculino</SelectItem>
            <SelectItem value="female">Femenino</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import type { DefaultCategory } from "@/lib/default-categories";
import type { WizardCategory } from "@/lib/race-wizard";
import type { Sex } from "@/types/app";

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `cat-${keyCounter}-${Date.now()}`;
}

export function makeCategory(source: DefaultCategory): WizardCategory {
  return {
    key: nextKey(),
    name: source.name,
    age_min: source.age_min,
    age_max: source.age_max,
    sex: source.sex,
  };
}

// "any" is the sentinel for "no sex restriction" used by the Select (Radix
// Select items cannot have an empty-string value).
const SEX_ANY = "any";

type Props = {
  categories: WizardCategory[];
  onChange: (next: WizardCategory[]) => void;
  presets: readonly DefaultCategory[];
  error?: string;
};

export function CategoriesStep({
  categories,
  onChange,
  presets,
  error,
}: Props) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function update(key: string, patch: Partial<WizardCategory>) {
    onChange(
      categories.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    );
  }

  function remove(key: string) {
    onChange(categories.filter((c) => c.key !== key));
  }

  function addPreset(preset: DefaultCategory) {
    onChange([...categories, makeCategory(preset)]);
  }

  function addBlank() {
    onChange([
      ...categories,
      { key: nextKey(), name: "", age_min: null, age_max: null, sex: null },
    ]);
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function parseAge(value: string): number | null {
    if (value.trim() === "") return null;
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        El orden de la lista define el orden de salida en las contrarreloj: la
        categoría de arriba sale primero.
      </p>

      <div className="flex flex-col gap-2">
        {categories.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No hay categorías. Agrega una con los accesos rápidos o el botón de
            abajo.
          </p>
        )}

        {categories.map((cat, index) => (
          <div
            key={cat.key}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index) {
                reorder(dragIndex, index);
                setDragIndex(index);
              }
            }}
            onDragEnd={() => setDragIndex(null)}
            className={cn(
              "flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-end",
              dragIndex === index && "opacity-60",
            )}
          >
            <div
              className="flex cursor-grab items-center self-center text-muted-foreground active:cursor-grabbing"
              aria-label="Reordenar categoría"
            >
              <GripVertical className="size-5" />
            </div>

            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor={`name-${cat.key}`} className="text-xs">
                Nombre
              </Label>
              <Input
                id={`name-${cat.key}`}
                value={cat.name}
                onChange={(e) => update(cat.key, { name: e.target.value })}
                placeholder="Ej: Elite Masculino"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`age-min-${cat.key}`} className="text-xs">
                Edad mín.
              </Label>
              <Input
                id={`age-min-${cat.key}`}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-20"
                value={cat.age_min ?? ""}
                onChange={(e) =>
                  update(cat.key, { age_min: parseAge(e.target.value) })
                }
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`age-max-${cat.key}`} className="text-xs">
                Edad máx.
              </Label>
              <Input
                id={`age-max-${cat.key}`}
                type="number"
                inputMode="numeric"
                min={0}
                className="w-20"
                value={cat.age_max ?? ""}
                onChange={(e) =>
                  update(cat.key, { age_max: parseAge(e.target.value) })
                }
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Sexo</Label>
              <Select
                value={cat.sex ?? SEX_ANY}
                onValueChange={(value) =>
                  update(cat.key, {
                    sex: value === SEX_ANY ? null : (value as Sex),
                  })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEX_ANY}>Cualquiera</SelectItem>
                  <SelectItem value="male">Masculino</SelectItem>
                  <SelectItem value="female">Femenino</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Eliminar categoría"
              onClick={() => remove(cat.key)}
              className="self-center text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={addBlank}
        className="self-start"
      >
        <Plus className="size-4" />
        Agregar categoría
      </Button>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Accesos rápidos</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => addPreset(preset)}
              className="cursor-pointer"
            >
              <Badge variant="outline" className="hover:bg-muted">
                <Plus className="size-3" />
                {preset.name}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

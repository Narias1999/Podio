"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { RiderImportDialog } from "@/components/rider-import-dialog";
import { ageAt, suggestCategory } from "@/lib/categories";
import {
  validateRiderRegistrationPayload,
  type CategoryBibRange,
  type RiderRegistrationPayload,
} from "@/lib/riders";
import type { Category, Sex } from "@/types/app";

const CATEGORY_NONE = "none";

export type RiderRow = {
  registration_id: string;
  rider_id: string;
  category_id: string;
  bib_number: number | null;
  status: "confirmed" | "dns";
  document_number: string;
  name: string;
  nationality: string | null;
  team: string | null;
  sex: Sex;
  date_of_birth: string;
  eps: string | null;
  phone: string | null;
};

type Draft = {
  document_number: string;
  name: string;
  sex: Sex | null;
  date_of_birth: string;
  team: string;
  nationality: string;
  eps: string;
  phone: string;
  category_id: string | null;
};

function blankDraft(): Draft {
  return {
    document_number: "",
    name: "",
    sex: null,
    date_of_birth: "",
    team: "",
    nationality: "",
    eps: "",
    phone: "",
    category_id: null,
  };
}

function rowToDraft(row: RiderRow): Draft {
  return {
    document_number: row.document_number,
    name: row.name,
    sex: row.sex,
    date_of_birth: row.date_of_birth,
    team: row.team ?? "",
    nationality: row.nationality ?? "",
    eps: row.eps ?? "",
    phone: row.phone ?? "",
    category_id: row.category_id,
  };
}

function draftToPayload(draft: Draft): RiderRegistrationPayload {
  return {
    document_number: draft.document_number.trim(),
    name: draft.name.trim(),
    sex: draft.sex,
    date_of_birth: draft.date_of_birth,
    team: draft.team.trim() || null,
    nationality: draft.nationality.trim() || null,
    eps: draft.eps.trim() || null,
    phone: draft.phone.trim() || null,
    category_id: draft.category_id,
  };
}

type Props = {
  slug: string;
  raceStartsAt: string;
  registrationsClosed: boolean;
  categories: Category[];
  initialRows: RiderRow[];
};

export function RidersManager({
  slug,
  raceStartsAt,
  registrationsClosed: initialClosed,
  categories,
  initialRows,
}: Props) {
  const [rows, setRows] = useState<RiderRow[]>(initialRows);
  const [registrationsClosed, setRegistrationsClosed] = useState(initialClosed);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<RiderRow | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [bibInput, setBibInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<RiderRow | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeRanges, setCloseRanges] = useState<CategoryBibRange[] | null>(null);

  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (categoryFilter !== "all" && row.category_id !== categoryFilter) {
        return false;
      }
      if (!term) return true;
      return (
        row.name.toLowerCase().includes(term) ||
        row.document_number.toLowerCase().includes(term) ||
        (row.bib_number != null && String(row.bib_number).includes(term))
      );
    });
  }, [rows, search, categoryFilter]);

  const usedCategoryCount = useMemo(
    () => new Set(rows.map((r) => r.category_id)).size,
    [rows],
  );

  function openAdd() {
    setEditing(null);
    setDraft(blankDraft());
    setBibInput("");
    setError(null);
    setPanelOpen(true);
  }

  function openEdit(row: RiderRow) {
    setEditing(row);
    setDraft(rowToDraft(row));
    setBibInput(row.bib_number != null ? String(row.bib_number) : "");
    setError(null);
    setPanelOpen(true);
  }

  // Auto-suggest a category whenever DOB + sex are both present (add mode only;
  // editing keeps the stored category unless the organizer changes it).
  function maybeSuggestCategory(next: Draft) {
    if (editing) return next;
    if (!next.sex || !/^\d{4}-\d{2}-\d{2}$/.test(next.date_of_birth)) return next;
    if (next.category_id) return next;
    const suggestion = suggestCategory(categories, {
      age: ageAt(next.date_of_birth, raceStartsAt),
      sex: next.sex,
    });
    return suggestion ? { ...next, category_id: suggestion.id } : next;
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft((prev) => maybeSuggestCategory({ ...prev, ...patch }));
  }

  function submitPanel() {
    setError(null);
    if (editing) {
      submitEdit(editing);
    } else {
      submitAdd();
    }
  }

  function submitAdd() {
    const payload = draftToPayload(draft);
    const validationError = validateRiderRegistrationPayload(
      payload,
      categories.map((c) => c.id),
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/riders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          rider?: RiderRow;
          registration?: { id: string; bib_number: number | null };
          error?: string;
        };
        if (!res.ok || !data.rider || !data.registration) {
          setError(data.error ?? "No se pudo registrar el corredor.");
          return;
        }
        const r = data.rider as unknown as {
          id: string;
          document_number: string;
          name: string;
          nationality: string | null;
          team: string | null;
          sex: Sex;
          date_of_birth: string;
          eps: string | null;
          phone: string | null;
        };
        const newRow: RiderRow = {
          registration_id: data.registration.id,
          rider_id: r.id,
          category_id: payload.category_id as string,
          bib_number: data.registration.bib_number,
          status: "confirmed",
          document_number: r.document_number,
          name: r.name,
          nationality: r.nationality,
          team: r.team,
          sex: r.sex,
          date_of_birth: r.date_of_birth,
          eps: r.eps,
          phone: r.phone,
        };
        setRows((prev) => [...prev, newRow]);
        toast.success("Corredor inscrito.");
        setPanelOpen(false);
      } catch {
        setError("No se pudo registrar el corredor. Inténtalo de nuevo.");
      }
    });
  }

  function submitEdit(row: RiderRow) {
    if (!draft.category_id) {
      setError("La categoría es obligatoria.");
      return;
    }
    const body: Record<string, unknown> = {
      category_id: draft.category_id,
      team: draft.team.trim() || null,
      eps: draft.eps.trim() || null,
      phone: draft.phone.trim() || null,
      nationality: draft.nationality.trim() || null,
    };

    if (registrationsClosed) {
      const trimmed = bibInput.trim();
      const parsed = trimmed === "" ? null : Number.parseInt(trimmed, 10);
      if (trimmed !== "" && (parsed === null || Number.isNaN(parsed) || parsed < 1)) {
        setError("El dorsal debe ser un número positivo.");
        return;
      }
      body.bib_number = parsed;
    }

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/riders/${row.registration_id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "No se pudo actualizar la inscripción.");
          return;
        }
        setRows((prev) =>
          prev.map((r) =>
            r.registration_id === row.registration_id
              ? {
                  ...r,
                  category_id: draft.category_id as string,
                  team: draft.team.trim() || null,
                  eps: draft.eps.trim() || null,
                  phone: draft.phone.trim() || null,
                  nationality: draft.nationality.trim() || null,
                  bib_number:
                    "bib_number" in body
                      ? (body.bib_number as number | null)
                      : r.bib_number,
                }
              : r,
          ),
        );
        toast.success("Inscripción actualizada.");
        setPanelOpen(false);
      } catch {
        setError("No se pudo actualizar la inscripción. Inténtalo de nuevo.");
      }
    });
  }

  function toggleDns(row: RiderRow) {
    const nextStatus = row.status === "dns" ? "confirmed" : "dns";
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/riders/${row.registration_id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: nextStatus }),
          },
        );
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo actualizar el estado.");
          return;
        }
        setRows((prev) =>
          prev.map((r) =>
            r.registration_id === row.registration_id
              ? { ...r, status: nextStatus }
              : r,
          ),
        );
        toast.success(
          nextStatus === "dns" ? "Marcado como DNS." : "Marcado como confirmado.",
        );
      } catch {
        toast.error("No se pudo actualizar el estado. Inténtalo de nuevo.");
      }
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/riders/${target.registration_id}`,
          { method: "DELETE" },
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "No se pudo eliminar la inscripción.");
          return;
        }
        setRows((prev) =>
          prev.filter((r) => r.registration_id !== target.registration_id),
        );
        toast.success("Corredor eliminado.");
        setPanelOpen(false);
      } catch {
        toast.error("No se pudo eliminar la inscripción. Inténtalo de nuevo.");
      }
    });
  }

  function closeRegistration() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/riders/close`, {
          method: "POST",
        });
        const data = (await res.json()) as {
          ranges?: CategoryBibRange[];
          assignments?: { registration_id: string; bib_number: number }[];
          error?: string;
        };
        if (!res.ok || !data.ranges) {
          toast.error(data.error ?? "No se pudo cerrar la inscripción.");
          return;
        }
        const bibByRegistration = new Map(
          (data.assignments ?? []).map((a) => [a.registration_id, a.bib_number]),
        );
        setRows((prev) =>
          prev.map((r) => ({
            ...r,
            bib_number: bibByRegistration.get(r.registration_id) ?? null,
          })),
        );
        setRegistrationsClosed(true);
        setCloseRanges(data.ranges);
        toast.success("Inscripción cerrada y dorsales asignados.");
        setCloseOpen(false);
      } catch {
        toast.error("No se pudo cerrar la inscripción. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Inscripciones</CardTitle>
            <CardDescription>
              {filteredRows.length} corredores en {usedCategoryCount}{" "}
              {usedCategoryCount === 1 ? "categoría" : "categorías"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!registrationsClosed && (
              <RiderImportDialog
                slug={slug}
                categories={categories}
                onImported={() => router.refresh()}
              />
            )}
            {rows.length > 0 && !registrationsClosed && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setCloseOpen(true)}
                disabled={pending}
              >
                Cerrar inscripción y asignar dorsales
              </Button>
            )}
            <Button type="button" onClick={openAdd} disabled={pending}>
              <Plus className="size-4" />
              Agregar corredor
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Buscar por nombre, documento o dorsal"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dorsal</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Equipo</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No hay corredores que coincidan.
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow
                  key={row.registration_id}
                  className={cn(
                    "cursor-pointer",
                    row.status === "dns" && "opacity-60",
                  )}
                  onClick={() => openEdit(row)}
                >
                  <TableCell className="font-medium">
                    {row.bib_number != null ? row.bib_number : "—"}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.team ?? "—"}
                  </TableCell>
                  <TableCell>{categoryNames.get(row.category_id) ?? "—"}</TableCell>
                  <TableCell>
                    {row.status === "dns" ? (
                      <Badge variant="secondary">DNS</Badge>
                    ) : (
                      <Badge variant="default">Confirmado</Badge>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => toggleDns(row)}
                      disabled={pending}
                    >
                      {row.status === "dns" ? "Quitar DNS" : "Marcar DNS"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar inscripción" : "Agregar corredor"}
            </SheetTitle>
            <SheetDescription>
              {editing
                ? "Documento, nombre, sexo y fecha de nacimiento pertenecen al perfil del corredor y no se editan aquí."
                : "El dorsal se asigna al cerrar la inscripción."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4">
            <Field label="Número de documento" htmlFor="rider-doc">
              <Input
                id="rider-doc"
                value={draft.document_number}
                onChange={(e) => updateDraft({ document_number: e.target.value })}
                disabled={!!editing}
              />
            </Field>
            <Field label="Nombre completo" htmlFor="rider-name">
              <Input
                id="rider-name"
                value={draft.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                disabled={!!editing}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sexo" htmlFor="rider-sex">
                <Select
                  value={draft.sex ?? ""}
                  onValueChange={(v) => updateDraft({ sex: v as Sex })}
                  disabled={!!editing}
                >
                  <SelectTrigger id="rider-sex" className="w-full">
                    <SelectValue placeholder="Selecciona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Masculino</SelectItem>
                    <SelectItem value="female">Femenino</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Fecha de nacimiento" htmlFor="rider-dob">
                <Input
                  id="rider-dob"
                  type="date"
                  value={draft.date_of_birth}
                  onChange={(e) => updateDraft({ date_of_birth: e.target.value })}
                  disabled={!!editing}
                />
              </Field>
            </div>
            <Field label="Categoría" htmlFor="rider-category">
              <Select
                value={draft.category_id ?? CATEGORY_NONE}
                onValueChange={(v) =>
                  setDraft((prev) => ({
                    ...prev,
                    category_id: v === CATEGORY_NONE ? null : v,
                  }))
                }
              >
                <SelectTrigger id="rider-category" className="w-full">
                  <SelectValue placeholder="Selecciona una categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Equipo / club (opcional)" htmlFor="rider-team">
              <Input
                id="rider-team"
                value={draft.team}
                onChange={(e) => updateDraft({ team: e.target.value })}
              />
            </Field>
            <Field label="Nacionalidad (opcional)" htmlFor="rider-nat">
              <Input
                id="rider-nat"
                value={draft.nationality}
                onChange={(e) => updateDraft({ nationality: e.target.value })}
              />
            </Field>
            <Field label="EPS (opcional)" htmlFor="rider-eps">
              <Input
                id="rider-eps"
                value={draft.eps}
                onChange={(e) => updateDraft({ eps: e.target.value })}
              />
            </Field>
            <Field label="Teléfono (opcional)" htmlFor="rider-phone">
              <Input
                id="rider-phone"
                value={draft.phone}
                onChange={(e) => updateDraft({ phone: e.target.value })}
              />
            </Field>
            {editing && registrationsClosed && (
              <Field label="Dorsal" htmlFor="rider-bib">
                <Input
                  id="rider-bib"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={bibInput}
                  onChange={(e) => setBibInput(e.target.value)}
                />
              </Field>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <SheetFooter>
            {editing && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(editing)}
                disabled={pending}
              >
                Eliminar corredor
              </Button>
            )}
            <Button type="button" onClick={submitPanel} disabled={pending}>
              {editing ? "Guardar cambios" : "Inscribir corredor"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este corredor?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Se eliminará la inscripción de "${deleteTarget.name}" en esta carrera.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Cerrar inscripción y asignar dorsales?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se asignará a cada categoría un rango de dorsales según su número
              de corredores confirmados y se asignarán al azar dentro del rango.
              Los corredores DNS no reciben dorsal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={closeRegistration}>
              Cerrar y asignar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {closeRanges && (
        <AlertDialog
          open={closeRanges !== null}
          onOpenChange={(open) => !open && setCloseRanges(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Dorsales asignados</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {closeRanges.map((r) => (
                    <li key={r.category_id}>
                      {r.category_name}: {r.from}–{r.to} ({r.count})
                    </li>
                  ))}
                </ul>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setCloseRanges(null)}>
                Entendido
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

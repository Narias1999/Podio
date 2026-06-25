"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Download, Upload, FileUp, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
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
  CSV_COLUMNS,
  normalizeRow,
  parseRiderCsv,
  validateRow,
  type CsvRow,
  type ParsedRiderRow,
  type RowFieldErrors,
} from "@/lib/csv";
import type { Category } from "@/types/app";

type Step = "download" | "upload" | "preview" | "summary";

type PreviewRow = {
  raw: CsvRow;
  normalized: ParsedRiderRow;
  errors: RowFieldErrors;
};

type ImportSummary = {
  imported: number;
  reusedProfiles: number;
  createdProfiles: number;
  byCategory: Record<string, number>;
};

type Props = {
  slug: string;
  categories: Category[];
  onImported: () => void;
};

// A sample row so organizers see the expected format (Story 07, Step 1).
const SAMPLE_ROW: Record<string, string> = {
  document_number: "1234567890",
  first_name: "Ana",
  last_name: "Gómez",
  sex: "female",
  date_of_birth: "1998-05-21",
  category: "",
  team: "Club Ciclístico",
  nationality: "Colombia",
  eps: "Sura",
  phone: "3001234567",
};

function buildTemplate(): string {
  const header = CSV_COLUMNS.join(",");
  const sample = CSV_COLUMNS.map((c) => SAMPLE_ROW[c] ?? "").join(",");
  return `${header}\n${sample}\n`;
}

export function RiderImportDialog({ slug, categories, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("download");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const categoryNames = useMemo(
    () => new Set(categories.map((c) => c.name.toLowerCase())),
    [categories],
  );

  const errorCount = useMemo(
    () => previewRows.filter((r) => Object.keys(r.errors).length > 0).length,
    [previewRows],
  );
  const validCount = previewRows.length - errorCount;
  const hasErrors = errorCount > 0;

  function reset() {
    setStep("download");
    setPreviewRows([]);
    setParseError(null);
    setSummary(null);
  }

  function openWizard() {
    reset();
    setOpen(true);
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplate()], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-corredores.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleFile(file: File) {
    setParseError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const result = parseRiderCsv(text);
      if (!result.ok) {
        setParseError(result.error);
        return;
      }

      // Detect duplicate document_number within the file (cross-row rule).
      const counts = new Map<string, number>();
      for (const row of result.rows) {
        const doc = row.document_number.trim().toLowerCase();
        if (doc) counts.set(doc, (counts.get(doc) ?? 0) + 1);
      }

      const rows: PreviewRow[] = result.rows.map((raw) => {
        const normalized = normalizeRow(raw);
        const errors = validateRow(raw, normalized, categoryNames);
        const doc = normalized.document_number.toLowerCase();
        if (doc && (counts.get(doc) ?? 0) > 1) {
          errors.document_number =
            "Este documento aparece más de una vez en el archivo.";
        }
        return { raw, normalized, errors };
      });

      // Second pass for unresolved auto-category (needs the full category list).
      flagUnresolvedCategories(rows);

      setPreviewRows(rows);
      setStep("preview");
    };
    reader.onerror = () => {
      setParseError(
        "No pudimos leer este archivo. Asegúrate de que esté guardado como CSV e inténtalo de nuevo.",
      );
    };
    reader.readAsText(file);
  }

  function flagUnresolvedCategories(rows: PreviewRow[]) {
    // We can only auto-suggest when we know the race start date, which the
    // server owns. Client-side we only flag the obvious "no category given and
    // no category-shaped rules exist" case so the organizer isn't surprised;
    // the authoritative resolution happens server-side. To keep the preview
    // honest, we flag a blank category only when NO category has age/sex rules
    // that could ever match (i.e. auto-assignment is impossible for this race).
    const anyAutoAssignable = categories.some(
      (c) => c.age_min !== null || c.age_max !== null || c.sex !== null,
    );
    if (anyAutoAssignable) return;
    for (const row of rows) {
      if (
        !row.normalized.category &&
        !row.errors.category &&
        Object.keys(row.errors).length === 0
      ) {
        row.errors.category =
          "Indica una categoría: esta carrera no tiene asignación automática.";
      }
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function confirmImport() {
    if (hasErrors || previewRows.length === 0) return;
    const rows = previewRows.map((r) => r.normalized);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/races/${slug}/riders/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        const data = (await res.json()) as {
          summary?: ImportSummary;
          error?: string;
          rowErrors?: { index: number; error: string }[];
        };
        if (!res.ok || !data.summary) {
          // Map any per-row server errors back into the preview (e.g. a blank
          // category the server couldn't auto-resolve) so they show inline.
          if (data.rowErrors && data.rowErrors.length > 0) {
            const byIndex = new Map(
              data.rowErrors.map((e) => [e.index, e.error]),
            );
            setPreviewRows((prev) =>
              prev.map((row, i) =>
                byIndex.has(i)
                  ? { ...row, errors: { ...row.errors, category: byIndex.get(i) } }
                  : row,
              ),
            );
          }
          toast.error(data.error ?? "No se pudo completar la importación.");
          return;
        }
        setSummary(data.summary);
        setStep("summary");
        onImported();
      } catch {
        toast.error("No se pudo completar la importación. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={openWizard}>
        <FileUp className="size-4" />
        Importar CSV
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Importar corredores desde CSV</SheetTitle>
            <SheetDescription>
              {step === "download" && "Descarga la plantilla y prepárala."}
              {step === "upload" && "Sube tu archivo CSV."}
              {step === "preview" &&
                "Revisa las filas antes de confirmar la importación."}
              {step === "summary" && "Importación completada."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            {step === "download" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  La plantilla incluye las columnas{" "}
                  <code className="text-xs">document_number</code>,{" "}
                  <code className="text-xs">first_name</code>,{" "}
                  <code className="text-xs">last_name</code>,{" "}
                  <code className="text-xs">sex</code>,{" "}
                  <code className="text-xs">date_of_birth</code>,{" "}
                  <code className="text-xs">category</code>,{" "}
                  <code className="text-xs">team</code>,{" "}
                  <code className="text-xs">nationality</code>,{" "}
                  <code className="text-xs">eps</code> y{" "}
                  <code className="text-xs">phone</code>. Son obligatorias{" "}
                  <strong>document_number</strong>, <strong>first_name</strong>,{" "}
                  <strong>last_name</strong>, <strong>sex</strong> (male o
                  female) y <strong>date_of_birth</strong> (AAAA-MM-DD). Si dejas{" "}
                  <strong>category</strong> en blanco, se asigna automáticamente
                  según la edad y el sexo.
                </p>
                <div>
                  <Button type="button" variant="outline" onClick={downloadTemplate}>
                    <Download className="size-4" />
                    Descargar plantilla
                  </Button>
                </div>
              </div>
            )}

            {step === "upload" && (
              <div className="flex flex-col gap-4">
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center"
                >
                  <Upload className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Arrastra tu archivo .csv aquí o
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Seleccionar archivo
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={onFileInputChange}
                  />
                </div>
                {parseError && (
                  <p className="text-sm text-destructive" role="alert">
                    {parseError}
                  </p>
                )}
              </div>
            )}

            {step === "preview" && (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  {hasErrors ? (
                    <span>
                      <strong>{validCount}</strong>{" "}
                      {validCount === 1
                        ? "fila lista para importar"
                        : "filas listas para importar"}
                      , <strong className="text-destructive">{errorCount}</strong>{" "}
                      {errorCount === 1
                        ? "fila tiene errores"
                        : "filas tienen errores"}
                      .
                    </span>
                  ) : (
                    <span>
                      <strong>{validCount}</strong>{" "}
                      {validCount === 1
                        ? "fila lista para importar"
                        : "filas listas para importar"}
                      .
                    </span>
                  )}
                </p>
                {hasErrors && (
                  <p className="text-sm text-muted-foreground">
                    Corrige el archivo y vuelve a subirlo. No se permiten
                    importaciones parciales.
                  </p>
                )}
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Documento</TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Sexo</TableHead>
                        <TableHead>Nacimiento</TableHead>
                        <TableHead>Categoría</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewRows.map((row, i) => {
                        const rowHasError = Object.keys(row.errors).length > 0;
                        return (
                          <TableRow key={i}>
                            <TableCell>
                              {rowHasError ? (
                                <XCircle className="size-4 text-destructive" />
                              ) : (
                                <CheckCircle2 className="size-4 text-emerald-600" />
                              )}
                            </TableCell>
                            <Cell
                              value={row.raw.document_number}
                              error={row.errors.document_number}
                            />
                            <Cell
                              value={
                                `${row.raw.first_name} ${row.raw.last_name}`.trim() ||
                                "—"
                              }
                              error={row.errors.first_name ?? row.errors.last_name}
                            />
                            <Cell value={row.raw.sex} error={row.errors.sex} />
                            <Cell
                              value={row.raw.date_of_birth}
                              error={row.errors.date_of_birth}
                            />
                            <Cell
                              value={row.raw.category || "Automática"}
                              error={row.errors.category}
                            />
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {step === "summary" && summary && (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border p-4">
                  <p className="text-2xl font-semibold">{summary.imported}</p>
                  <p className="text-sm text-muted-foreground">
                    {summary.imported === 1
                      ? "corredor importado"
                      : "corredores importados"}
                  </p>
                </div>
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                  <p>
                    {summary.createdProfiles}{" "}
                    {summary.createdProfiles === 1
                      ? "perfil nuevo creado"
                      : "perfiles nuevos creados"}
                    .
                  </p>
                  {summary.reusedProfiles > 0 && (
                    <p>
                      {summary.reusedProfiles}{" "}
                      {summary.reusedProfiles === 1
                        ? "perfil existente reutilizado por número de documento"
                        : "perfiles existentes reutilizados por número de documento"}
                      .
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Por categoría</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(summary.byCategory).map(([name, count]) => (
                      <Badge key={name} variant="secondary">
                        {name}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <SheetFooter>
            {step === "download" && (
              <Button type="button" onClick={() => setStep("upload")}>
                <Upload className="size-4" />
                Subir tu archivo
              </Button>
            )}
            {step === "upload" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("download")}
              >
                Volver
              </Button>
            )}
            {step === "preview" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setParseError(null);
                    setStep("upload");
                  }}
                  disabled={pending}
                >
                  Volver a subir archivo
                </Button>
                <Button
                  type="button"
                  onClick={confirmImport}
                  disabled={hasErrors || previewRows.length === 0 || pending}
                >
                  {pending && <Spinner />}
                  Confirmar importación
                </Button>
              </>
            )}
            {step === "summary" && (
              <Button type="button" onClick={() => setOpen(false)}>
                Ver lista de corredores
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Cell({ value, error }: { value: string; error?: string }) {
  return (
    <TableCell className={error ? "text-destructive" : undefined}>
      <span>{value || "—"}</span>
      {error && <span className="mt-0.5 block text-xs">{error}</span>}
    </TableCell>
  );
}

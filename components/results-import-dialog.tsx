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
  RESULTS_CSV_COLUMNS,
  RESULTS_CSV_STATUSES,
  normalizeResultRow,
  parseResultsCsv,
  validateResultRow,
  type ParsedResultRow,
  type ResultRowFieldErrors,
  type ResultsCsvRow,
} from "@/lib/results-csv";
import { findDuplicatePositions } from "@/lib/results";

type Step = "download" | "upload" | "preview" | "summary";

type PreviewRow = {
  raw: ResultsCsvRow;
  normalized: ParsedResultRow;
  errors: ResultRowFieldErrors;
};

type ImportSummary = {
  imported: number;
  finished: number;
  dnf: number;
  dsq: number;
  dns: number;
};

type Props = {
  slug: string;
  stageNumber: number;
  /** Bib → category id for the race, used to validate bibs and dup positions. */
  bibCategories: Record<number, string>;
  onImported: () => void;
};

// A sample row so organizers see the expected format (Story 09, Step 1).
const SAMPLE_ROW: Record<string, string> = {
  bib_number: "12",
  finish_time: "3:42:15",
  position: "1",
  status: "finished",
  dnf_reason: "",
  dsq_reason: "",
};

function buildTemplate(): string {
  // A leading comment documents the valid status values and which columns are
  // required, then the header row, then a sample row.
  const comment =
    "# Estados válidos: finished, dnf, dsq, dns. " +
    "Obligatorios: bib_number, status. " +
    "Si status es finished: finish_time (H:MM:SS) y position obligatorios.";
  const header = RESULTS_CSV_COLUMNS.join(",");
  const sample = RESULTS_CSV_COLUMNS.map((c) => SAMPLE_ROW[c] ?? "").join(",");
  return `${comment}\n${header}\n${sample}\n`;
}

export function ResultsImportDialog({
  slug,
  stageNumber,
  bibCategories,
  onImported,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("download");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const knownBibs = useMemo(
    () => new Set(Object.keys(bibCategories).map((b) => Number.parseInt(b, 10))),
    [bibCategories],
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
    link.download = "plantilla-resultados.csv";
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
      const result = parseResultsCsv(text);
      if (!result.ok) {
        setParseError(result.error);
        return;
      }

      // Cross-row: count bibs to flag duplicates within the file.
      const bibCounts = new Map<number, number>();
      const normalizedRows = result.rows.map((raw) => normalizeResultRow(raw));
      for (const row of normalizedRows) {
        if (row.bib_number != null) {
          bibCounts.set(row.bib_number, (bibCounts.get(row.bib_number) ?? 0) + 1);
        }
      }

      const rows: PreviewRow[] = result.rows.map((raw, i) => {
        const normalized = normalizedRows[i];
        const errors = validateResultRow(normalized, knownBibs);
        if (
          normalized.bib_number != null &&
          (bibCounts.get(normalized.bib_number) ?? 0) > 1
        ) {
          errors.bib_number =
            "Este dorsal aparece más de una vez en el archivo.";
        }
        return { raw, normalized, errors };
      });

      // Cross-row: positions must be unique within each category.
      flagDuplicatePositions(rows);

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

  function flagDuplicatePositions(rows: PreviewRow[]) {
    const duplicates = findDuplicatePositions(
      rows
        .filter(
          (r) =>
            r.normalized.status === "finished" &&
            r.normalized.position != null &&
            r.normalized.bib_number != null,
        )
        .map((r) => ({
          // Use bib as the row key (registration not known client-side).
          registration_id: String(r.normalized.bib_number),
          category_id: bibCategories[r.normalized.bib_number as number] ?? "",
          position: r.normalized.position,
        })),
    );
    for (const row of rows) {
      if (
        row.normalized.bib_number != null &&
        duplicates.has(String(row.normalized.bib_number)) &&
        !row.errors.position
      ) {
        row.errors.position =
          "La posición está duplicada dentro de la categoría.";
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
    const rows = previewRows.map((r) => ({
      bib_number: r.normalized.bib_number,
      status: r.normalized.status,
      finish_time: r.normalized.finish_time,
      position: r.normalized.position,
      dnf_reason: r.normalized.dnf_reason,
      dsq_reason: r.normalized.dsq_reason,
    }));
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/races/${slug}/stages/${stageNumber}/results/import`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          },
        );
        const data = (await res.json()) as {
          summary?: ImportSummary;
          error?: string;
          rowErrors?: { index: number; error: string }[];
        };
        if (!res.ok || !data.summary) {
          if (data.rowErrors && data.rowErrors.length > 0) {
            const byIndex = new Map(
              data.rowErrors.map((e) => [e.index, e.error]),
            );
            setPreviewRows((prev) =>
              prev.map((row, i) =>
                byIndex.has(i)
                  ? { ...row, errors: { ...row.errors, bib_number: byIndex.get(i) } }
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
            <SheetTitle>Importar resultados desde CSV</SheetTitle>
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
                  <code className="text-xs">bib_number</code>,{" "}
                  <code className="text-xs">finish_time</code>,{" "}
                  <code className="text-xs">position</code>,{" "}
                  <code className="text-xs">status</code>,{" "}
                  <code className="text-xs">dnf_reason</code> y{" "}
                  <code className="text-xs">dsq_reason</code>. Son obligatorias{" "}
                  <strong>bib_number</strong> y <strong>status</strong> (uno de{" "}
                  {RESULTS_CSV_STATUSES.join(", ")}). Cuando el estado es{" "}
                  <strong>finished</strong>, también son obligatorios{" "}
                  <strong>finish_time</strong> (formato H:MM:SS) y{" "}
                  <strong>position</strong>.
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
                        <TableHead>Dorsal</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Tiempo</TableHead>
                        <TableHead>Posición</TableHead>
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
                              value={row.raw.bib_number}
                              error={row.errors.bib_number}
                            />
                            <Cell value={row.raw.status} error={row.errors.status} />
                            <Cell
                              value={row.raw.finish_time}
                              error={row.errors.finish_time}
                            />
                            <Cell
                              value={row.raw.position}
                              error={row.errors.position}
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
                      ? "resultado importado"
                      : "resultados importados"}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Por estado</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {summary.finished} finalizaron
                    </Badge>
                    <Badge variant="secondary">{summary.dnf} DNF</Badge>
                    <Badge variant="secondary">{summary.dsq} DSQ</Badge>
                    {summary.dns > 0 && (
                      <Badge variant="secondary">{summary.dns} DNS</Badge>
                    )}
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
                Ver resultados
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

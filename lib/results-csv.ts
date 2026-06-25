/**
 * CSV parsing + validation for the bulk results importer (Story 09). Built on
 * the framework-agnostic foundation in `lib/csv.ts` (delimiter auto-detection,
 * quoted-field splitting, BOM/CRLF handling, shared error string) and the
 * time/status helpers in `lib/results.ts` so finish-time parsing and the set of
 * valid statuses match manual entry (Story 08) exactly. No React, no Supabase —
 * the same rules run in the client preview (Step 3) and on the server before
 * any write (the server is authoritative).
 *
 * The results CSV is per stage and keyed by bib number: each row maps a bib to
 * a status and (when `finished`) a finish time + position. Bib existence and
 * the stage lock are checked server-side; the static per-row rules here cover
 * the column-level shape (status validity, finish_time/position presence and
 * format), and the cross-row rules cover duplicate bibs and duplicate positions
 * within a category.
 */

import {
  UNREADABLE_ERROR,
  detectDelimiter,
  splitCsvLines,
  splitLine,
} from "@/lib/csv";
import { parseTimeToSeconds } from "@/lib/results";
import type { ResultStatus } from "@/types/app";

/** The results CSV columns, in template order. */
export const RESULTS_CSV_COLUMNS = [
  "bib_number",
  "finish_time",
  "position",
  "status",
  "dnf_reason",
  "dsq_reason",
] as const;

export type ResultsCsvColumn = (typeof RESULTS_CSV_COLUMNS)[number];

/** Required columns — the header must contain these or the file is rejected. */
const REQUIRED_HEADER_COLUMNS: readonly ResultsCsvColumn[] = [
  "bib_number",
  "status",
];

/** Valid status values accepted in the `status` column. */
export const RESULTS_CSV_STATUSES: readonly ResultStatus[] = [
  "finished",
  "dnf",
  "dsq",
  "dns",
];

/** One parsed CSV row keyed by column name (values trimmed). */
export type ResultsCsvRow = Record<ResultsCsvColumn, string>;

/** A normalized results row ready to be turned into a result payload. */
export type ParsedResultRow = {
  bib_number: number | null; // null when blank or not a positive integer
  bib_number_raw: string;
  status: ResultStatus | null; // null when blank or unrecognized
  finish_time: string; // raw "H:MM:SS" string (may be blank)
  position: number | null; // null when blank or not a positive integer
  position_raw: string;
  dnf_reason: string | null;
  dsq_reason: string | null;
};

export type ParseResultsCsvResult =
  | { ok: true; rows: ResultsCsvRow[] }
  | { ok: false; error: string };

/**
 * Parses raw CSV text into results rows keyed by the expected columns. Accepts
 * comma- or semicolon-delimited files and tolerates a UTF-8 BOM and CRLF
 * endings. Extra columns are ignored; missing optional columns become "".
 * Returns a plain-language Spanish error when the file is empty or the header
 * is missing a required column.
 */
export function parseResultsCsv(text: string): ParseResultsCsvResult {
  const lines = splitCsvLines(text);

  if (lines.length < 2) {
    return { ok: false, error: UNREADABLE_ERROR };
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = splitLine(lines[0], delimiter).map((h) =>
    h.trim().toLowerCase(),
  );

  const missingRequired = REQUIRED_HEADER_COLUMNS.filter(
    (col) => !header.includes(col),
  );
  if (missingRequired.length > 0) {
    return { ok: false, error: UNREADABLE_ERROR };
  }

  const indexOf = (col: ResultsCsvColumn) => header.indexOf(col);

  const rows: ResultsCsvRow[] = lines.slice(1).map((line) => {
    const fields = splitLine(line, delimiter);
    const row = {} as ResultsCsvRow;
    for (const col of RESULTS_CSV_COLUMNS) {
      const idx = indexOf(col);
      row[col] = idx >= 0 ? (fields[idx] ?? "").trim() : "";
    }
    return row;
  });

  return { ok: true, rows };
}

/** Parses a bib/position-style positive integer, or null when invalid/blank. */
function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return n > 0 ? n : null;
}

/** Normalizes a raw results CSV row into a typed row. */
export function normalizeResultRow(row: ResultsCsvRow): ParsedResultRow {
  const statusRaw = row.status.trim().toLowerCase();
  const status = RESULTS_CSV_STATUSES.includes(statusRaw as ResultStatus)
    ? (statusRaw as ResultStatus)
    : null;

  return {
    bib_number: parsePositiveInt(row.bib_number),
    bib_number_raw: row.bib_number.trim(),
    status,
    finish_time: row.finish_time.trim(),
    position: parsePositiveInt(row.position),
    position_raw: row.position.trim(),
    dnf_reason: row.dnf_reason.trim() || null,
    dsq_reason: row.dsq_reason.trim() || null,
  };
}

/** Per-cell errors for a results row, keyed by the column the error belongs to. */
export type ResultRowFieldErrors = Partial<Record<ResultsCsvColumn, string>>;

/**
 * Validates one already-normalized results row against the static (column-level)
 * rules: bib presence, status validity, and the finish_time/position rules that
 * apply when status is `finished`. Cross-row checks (duplicate bibs, duplicate
 * positions within a category) and bib existence are handled by the caller.
 * `knownBibs` is the set of bib numbers registered for the race; when provided,
 * an unknown bib is flagged. Returns a map of column → Spanish message (empty
 * when the row is valid).
 */
export function validateResultRow(
  row: ParsedResultRow,
  knownBibs?: ReadonlySet<number>,
): ResultRowFieldErrors {
  const errors: ResultRowFieldErrors = {};

  if (!row.bib_number_raw) {
    errors.bib_number = "El dorsal es obligatorio.";
  } else if (row.bib_number === null) {
    errors.bib_number = "El dorsal debe ser un número entero positivo.";
  } else if (knownBibs && !knownBibs.has(row.bib_number)) {
    errors.bib_number = "No hay ningún corredor con este dorsal en la carrera.";
  }

  if (!row.status) {
    errors.status =
      "El estado debe ser finished, dnf, dsq o dns.";
  } else if (row.status === "finished") {
    if (!row.finish_time) {
      errors.finish_time =
        "El tiempo de llegada es obligatorio cuando el estado es finished.";
    } else if (parseTimeToSeconds(row.finish_time) === null) {
      errors.finish_time = "El tiempo debe tener el formato H:MM:SS.";
    }
    if (!row.position_raw) {
      errors.position =
        "La posición es obligatoria cuando el estado es finished.";
    } else if (row.position === null) {
      errors.position = "La posición debe ser un número entero positivo.";
    }
  }

  return errors;
}

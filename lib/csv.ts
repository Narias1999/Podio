/**
 * Shared CSV helpers for the bulk rider importer (Story 07). Kept framework-
 * agnostic (no React, no Supabase) so the same parsing/validation rules run on
 * the client (Step 3 preview) and could be reused by the bulk-results importer
 * (Story 09). Parsing handles both comma- and semicolon-delimited files plus
 * quoted fields; validation mirrors the per-row rules in the story.
 */

import type { Sex } from "@/types/app";

/** The CSV columns, in template order. */
export const CSV_COLUMNS = [
  "document_number",
  "first_name",
  "last_name",
  "sex",
  "date_of_birth",
  "category",
  "team",
  "nationality",
  "eps",
  "phone",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Required columns — a row missing any of these (empty) is flagged. */
export const REQUIRED_COLUMNS: readonly CsvColumn[] = [
  "document_number",
  "first_name",
  "last_name",
  "sex",
  "date_of_birth",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One parsed CSV row keyed by column name (values trimmed). */
export type CsvRow = Record<CsvColumn, string>;

/** A normalized row ready to be turned into a registration payload. */
export type ParsedRiderRow = {
  document_number: string;
  name: string;
  sex: Sex | null;
  date_of_birth: string;
  category: string; // raw category name from CSV (may be blank)
  team: string | null;
  nationality: string | null;
  eps: string | null;
  phone: string | null;
};

/** Detects the delimiter from the header line: prefers `;` when it appears. */
export function detectDelimiter(headerLine: string): "," | ";" {
  return headerLine.includes(";") ? ";" : ",";
}

/**
 * Splits a single CSV line into fields, honouring double-quoted values (with
 * `""` as an escaped quote). Good enough for the flat rider template — there
 * are no embedded newlines in the supported columns.
 */
export function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export type ParseCsvResult =
  | { ok: true; rows: CsvRow[] }
  | { ok: false; error: string };

export const UNREADABLE_ERROR =
  "No pudimos leer este archivo. Asegúrate de que esté guardado como CSV e inténtalo de nuevo.";

/**
 * Strips a leading UTF-8 BOM and splits raw CSV text into non-empty lines
 * (tolerating CRLF/CR endings). Shared by the rider and results importers.
 */
export function splitCsvLines(text: string): string[] {
  const cleaned = text.replace(/^﻿/, "");
  return cleaned.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
}

/**
 * Parses raw CSV text into rows keyed by the expected columns. Accepts comma-
 * or semicolon-delimited files and tolerates a UTF-8 BOM and CRLF endings.
 * Extra columns in the file are ignored; missing optional columns become "".
 * Returns a plain-language Spanish error when the file is empty or the header
 * doesn't contain the required columns.
 */
export function parseRiderCsv(text: string): ParseCsvResult {
  const lines = splitCsvLines(text);

  if (lines.length < 2) {
    return { ok: false, error: UNREADABLE_ERROR };
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = splitLine(lines[0], delimiter).map((h) =>
    h.trim().toLowerCase(),
  );

  const missingRequired = REQUIRED_COLUMNS.filter(
    (col) => !header.includes(col),
  );
  if (missingRequired.length > 0) {
    return { ok: false, error: UNREADABLE_ERROR };
  }

  const indexOf = (col: CsvColumn) => header.indexOf(col);

  const rows: CsvRow[] = lines.slice(1).map((line) => {
    const fields = splitLine(line, delimiter);
    const row = {} as CsvRow;
    for (const col of CSV_COLUMNS) {
      const idx = indexOf(col);
      row[col] = idx >= 0 ? (fields[idx] ?? "").trim() : "";
    }
    return row;
  });

  return { ok: true, rows };
}

/** Normalizes a raw CSV row into a typed rider row (joins first + last name). */
export function normalizeRow(row: CsvRow): ParsedRiderRow {
  const sexRaw = row.sex.trim().toLowerCase();
  const sex: Sex | null =
    sexRaw === "male" ? "male" : sexRaw === "female" ? "female" : null;
  const name = [row.first_name.trim(), row.last_name.trim()]
    .filter(Boolean)
    .join(" ");

  return {
    document_number: row.document_number.trim(),
    name,
    sex,
    date_of_birth: row.date_of_birth.trim(),
    category: row.category.trim(),
    team: row.team.trim() || null,
    nationality: row.nationality.trim() || null,
    eps: row.eps.trim() || null,
    phone: row.phone.trim() || null,
  };
}

/** Per-cell errors for a row, keyed by the column the error belongs to. */
export type RowFieldErrors = Partial<Record<CsvColumn, string>>;

/**
 * Validates one already-normalized row against the static rules (required
 * fields, sex/date formats, category-name membership). Cross-row checks
 * (duplicate document_number) and auto-category resolution are handled by the
 * caller. `categoryNames` is the lowercased set of the race's category names.
 * Returns a map of column → Spanish message (empty when the row is valid).
 */
export function validateRow(
  raw: CsvRow,
  row: ParsedRiderRow,
  categoryNames: ReadonlySet<string>,
): RowFieldErrors {
  const errors: RowFieldErrors = {};

  if (!row.document_number) {
    errors.document_number = "El número de documento es obligatorio.";
  }
  if (!raw.first_name.trim()) {
    errors.first_name = "El nombre es obligatorio.";
  }
  if (!raw.last_name.trim()) {
    errors.last_name = "El apellido es obligatorio.";
  }
  if (!row.sex) {
    errors.sex = "El sexo debe ser male o female.";
  }
  if (!row.date_of_birth) {
    errors.date_of_birth = "La fecha de nacimiento es obligatoria.";
  } else if (!DATE_RE.test(row.date_of_birth) || Number.isNaN(Date.parse(row.date_of_birth))) {
    errors.date_of_birth = "La fecha debe tener el formato AAAA-MM-DD.";
  }
  if (row.category && !categoryNames.has(row.category.toLowerCase())) {
    errors.category = "La categoría no existe en esta carrera.";
  }

  return errors;
}

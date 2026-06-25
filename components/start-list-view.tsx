"use client";

import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export type StartListRow = {
  registration_id: string;
  position: number;
  start_time: string | null;
  bib_number: number | null;
  rider_name: string;
  team: string | null;
  category_id: string;
  category_name: string;
  category_sort_order: number;
};

type SortKey = "start_time" | "position" | "bib_number";

type Props = {
  raceName: string;
  stageName: string;
  stageDateLabel: string;
  intervalSeconds: number | null;
  rows: StartListRow[];
};

function formatStartTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "HH:mm:ss", { locale: es });
}

/** Groups rows by category, preserving category sort order. */
function groupByCategory(
  rows: StartListRow[],
): { category_id: string; category_name: string; rows: StartListRow[] }[] {
  const byId = new Map<
    string,
    { category_id: string; category_name: string; sortOrder: number; rows: StartListRow[] }
  >();
  for (const row of rows) {
    const existing = byId.get(row.category_id);
    if (existing) {
      existing.rows.push(row);
    } else {
      byId.set(row.category_id, {
        category_id: row.category_id,
        category_name: row.category_name,
        sortOrder: row.category_sort_order,
        rows: [row],
      });
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ category_id, category_name, rows }) => ({
      category_id,
      category_name,
      rows,
    }));
}

function sortRows(rows: StartListRow[], sortKey: SortKey): StartListRow[] {
  const sorted = [...rows];
  if (sortKey === "position") {
    sorted.sort((a, b) => a.position - b.position);
  } else if (sortKey === "bib_number") {
    sorted.sort((a, b) => (a.bib_number ?? Infinity) - (b.bib_number ?? Infinity));
  } else {
    sorted.sort((a, b) => {
      const aTime = a.start_time ? new Date(a.start_time).getTime() : Infinity;
      const bTime = b.start_time ? new Date(b.start_time).getTime() : Infinity;
      return aTime - bTime;
    });
  }
  return sorted;
}

const CSV_HEADER = [
  "Posición",
  "Hora de salida",
  "Dorsal",
  "Corredor",
  "Equipo",
  "Categoría",
];

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(rows: StartListRow[]): string {
  const sorted = sortRows(rows, "start_time");
  const lines = [CSV_HEADER.join(",")];
  for (const row of sorted) {
    lines.push(
      [
        String(row.position),
        formatStartTime(row.start_time),
        row.bib_number != null ? String(row.bib_number) : "",
        row.rider_name,
        row.team ?? "",
        row.category_name,
      ]
        .map(escapeCsvField)
        .join(","),
    );
  }
  return lines.join("\n");
}

function downloadCsv(rows: StartListRow[], stageName: string) {
  const csv = buildCsv(rows);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `orden-de-salida-${stageName.toLowerCase().replace(/\s+/g, "-")}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function StartListView({
  raceName,
  stageName,
  stageDateLabel,
  intervalSeconds,
  rows,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("start_time");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const categories = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; sortOrder: number }>();
    for (const row of rows) {
      if (!seen.has(row.category_id)) {
        seen.set(row.category_id, {
          id: row.category_id,
          name: row.category_name,
          sortOrder: row.category_sort_order,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (categoryFilter === "all") return rows;
    return rows.filter((r) => r.category_id === categoryFilter);
  }, [rows, categoryFilter]);

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey),
    [filteredRows, sortKey],
  );

  // When sorting by position/bib (not start time), category grouping headers
  // still follow each category's own sort order; rows within each group keep
  // the active sort.
  const grouped = useMemo(() => {
    const groups = groupByCategory(sortedRows);
    return groups.map((g) => ({ ...g, rows: sortRows(g.rows, sortKey) }));
  }, [sortedRows, sortKey]);

  return (
    <div className="flex flex-col gap-6 print:gap-3">
      <div
        id="start-list-print-header"
        className="hidden flex-col gap-1 print:flex"
      >
        <h1 className="text-xl font-semibold">{raceName}</h1>
        <p className="text-sm">{stageName}</p>
        <p className="text-sm text-muted-foreground">{stageDateLabel}</p>
      </div>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Información de la etapa</CardTitle>
          <CardDescription className="capitalize">
            {stageDateLabel}
            {intervalSeconds != null && (
              <> · Los corredores salen cada {intervalSeconds} segundos</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Categoría</span>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[200px]">
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
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Ordenar por</span>
              <Select
                value={sortKey}
                onValueChange={(v) => setSortKey(v as SortKey)}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="start_time">Hora de salida</SelectItem>
                  <SelectItem value="position">Posición</SelectItem>
                  <SelectItem value="bib_number">Dorsal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadCsv(rows, stageName)}
            >
              Descargar CSV
            </Button>
            <Button type="button" variant="outline" onClick={() => window.print()}>
              Descargar PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Desktop / print table */}
      <Card className="hidden md:block print:block print:border-none print:shadow-none">
        <CardContent className="print:p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Pos.</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Dorsal</TableHead>
                <TableHead>Corredor</TableHead>
                <TableHead>Equipo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map((group) => (
                <Fragment key={group.category_id}>
                  <TableRow className="bg-muted">
                    <TableCell colSpan={5} className="font-semibold">
                      {group.category_name}
                    </TableCell>
                  </TableRow>
                  {group.rows.map((row) => (
                    <TableRow key={row.registration_id}>
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
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile: card-per-rider layout */}
      <div className="flex flex-col gap-4 md:hidden print:hidden">
        {grouped.map((group) => (
          <div key={group.category_id} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {group.category_name}
            </h2>
            {group.rows.map((row) => (
              <Card key={row.registration_id} size="sm">
                <CardContent className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{row.rider_name}</span>
                    <span className="text-sm text-muted-foreground">
                      Pos. {row.position}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Dorsal {row.bib_number != null ? row.bib_number : "—"}</span>
                    <span>{formatStartTime(row.start_time)}</span>
                  </div>
                  {row.team && (
                    <span className="text-sm text-muted-foreground">
                      {row.team}
                    </span>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

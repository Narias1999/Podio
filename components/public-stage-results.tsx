"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { RESULT_STATUS_LABELS } from "@/lib/results";
import type { PublicStageResults } from "@/lib/public-results";

type Props = {
  stageId: string;
  /** True for TT stages → "Tiempo neto" column label + explanatory tooltip. */
  isTimeTrial: boolean;
  /** True while the stage has an active live session (drives the live banner). */
  isLive: boolean;
  results: PublicStageResults;
};

const NET_TIME_TOOLTIP =
  "El tiempo neto descuenta el desfase de salida individual de cada corredor: " +
  "mide el tiempo real sobre el recorrido, no la hora de llegada en pantalla.";

/**
 * Public stage results (Story 14). Renders the server-computed standings with a
 * category filter and a mobile card layout, and — during a live session —
 * subscribes to Supabase Realtime for this stage's `results` so the standings
 * refresh in place (via `router.refresh()`) without a full reload.
 *
 * The subscription is keyed by `stageId` (channel `results:stage:<id>`, table
 * `public.results`, filter `stage_id=eq.<id>`). Stories 19/22 broadcast result
 * inserts/updates on the same `results` rows, so any write to this stage's
 * results triggers a refresh here. RLS is off, so the anon client can subscribe
 * (accepted per spec — the data is public once the race is published).
 */
export function PublicStageResults({
  stageId,
  isTimeTrial,
  isLive,
  results,
}: Props) {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // `now` ticks once a second so the "hace X segundos" label stays current;
  // the elapsed seconds are derived from `updatedAt` rather than stored, so we
  // never call setState synchronously inside an effect.
  const [now, setNow] = useState<number>(() => Date.now());
  const secondsAgo =
    updatedAt == null ? 0 : Math.max(0, Math.floor((now - updatedAt) / 1000));

  // Realtime subscription, only while the stage is live. Keyed by stage id so
  // the channel is unique per stage and Stories 19/22 can broadcast to it.
  useEffect(() => {
    if (!isLive) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`results:stage:${stageId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "results",
          filter: `stage_id=eq.${stageId}`,
        },
        () => {
          const ts = Date.now();
          setUpdatedAt(ts);
          setNow(ts);
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isLive, stageId, router]);

  // Recency indicator: tick `now` once a second so the derived "hace X
  // segundos" label stays current. Only runs once there's been an update.
  useEffect(() => {
    if (updatedAt == null) return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const visibleCategories = useMemo(() => {
    if (categoryFilter === "all") return results.categories;
    return results.categories.filter((c) => c.category_id === categoryFilter);
  }, [results.categories, categoryFilter]);

  const timeLabel = isTimeTrial ? "Tiempo neto" : "Tiempo";

  const timeHeader = isTimeTrial ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted underline-offset-2">
            {timeLabel}
          </span>
        </TooltipTrigger>
        <TooltipContent>{NET_TIME_TOOLTIP}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    timeLabel
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Todas las categorías" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {results.categories.map((c) => (
              <SelectItem key={c.category_id} value={c.category_id}>
                {c.category_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isLive && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge className="bg-red-600 text-white hover:bg-red-600">
              En vivo
            </Badge>
            {updatedAt != null && (
              <span aria-live="polite">
                Actualizado hace {secondsAgo}{" "}
                {secondsAgo === 1 ? "segundo" : "segundos"}
              </span>
            )}
          </div>
        )}
      </div>

      {visibleCategories.map((category) => (
        <div key={category.category_id} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {category.category_name}
          </h2>

          {/* Desktop / tablet table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Pos.</TableHead>
                  <TableHead className="w-16">Dorsal</TableHead>
                  <TableHead>Corredor</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead className="text-right">{timeHeader}</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {category.finishers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      Sin llegadas registradas en esta categoría.
                    </TableCell>
                  </TableRow>
                ) : (
                  category.finishers.map((rider) => (
                    <TableRow key={rider.registration_id}>
                      <TableCell className="font-medium">
                        {rider.position}
                      </TableCell>
                      <TableCell>
                        {rider.bib_number != null ? rider.bib_number : "—"}
                      </TableCell>
                      <TableCell>{rider.rider_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {rider.team ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {rider.net_time}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {rider.gap_to_leader}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {category.nonFinishers.map((rider) => (
                  <TableRow
                    key={rider.registration_id}
                    className="opacity-70"
                  >
                    <TableCell className="text-muted-foreground">—</TableCell>
                    <TableCell>
                      {rider.bib_number != null ? rider.bib_number : "—"}
                    </TableCell>
                    <TableCell>{rider.rider_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {rider.team ?? "—"}
                    </TableCell>
                    <TableCell className="text-right" colSpan={2}>
                      <Badge variant="secondary">
                        {RESULT_STATUS_LABELS[rider.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card layout */}
          <div className="flex flex-col gap-2 md:hidden">
            {category.finishers.length === 0 &&
              category.nonFinishers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sin llegadas registradas en esta categoría.
                </p>
              )}
            {category.finishers.map((rider) => (
              <div
                key={rider.registration_id}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <div className="w-6 text-center text-lg font-semibold tabular-nums">
                  {rider.position}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{rider.rider_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Dorsal {rider.bib_number ?? "—"}
                    {rider.team ? ` · ${rider.team}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium tabular-nums">{rider.net_time}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {rider.gap_to_leader}
                  </p>
                </div>
              </div>
            ))}
            {category.nonFinishers.map((rider) => (
              <div
                key={rider.registration_id}
                className="flex items-center gap-3 rounded-md border p-3 opacity-70"
              >
                <div className="w-6 text-center text-muted-foreground">—</div>
                <div className="flex-1">
                  <p className="font-medium">{rider.rider_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Dorsal {rider.bib_number ?? "—"}
                    {rider.team ? ` · ${rider.team}` : ""}
                  </p>
                </div>
                <Badge variant="secondary">
                  {RESULT_STATUS_LABELS[rider.status]}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

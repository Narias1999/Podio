"use client";

// Story 17 — TT start-line view.
//
// A single operator opens this at the start gate, presses "Start TT" when the
// first rider departs, then leaves it running untouched. It then counts down to
// each rider's scheduled departure, advancing automatically purely from elapsed
// time vs. each rider's re-anchored scheduled departure (see `lib/tt-live.ts`).
//
// Shared infra used (per Stories 15/16):
//   - The Start press goes through the write queue (`writeQueue.enqueue`), which
//     POSTs to the registered `stage_category_starts:upsert` endpoint. NO direct
//     privileged Supabase write happens from the client.
//   - `useWriteQueueSync()` drives the 60s retry loop.
//   - `<ConnectivityIndicator />` is the first element (fixed top bar); main
//     content gets `pt-10` so it isn't hidden behind it.
//   - On Start we ALSO broadcast a Realtime event so the finish-line view
//     (Story 18) syncs the anchor immediately (channel/event in `lib/tt-live.ts`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { Button } from "@/components/ui/button";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ConnectivityIndicator } from "@/components/connectivity-indicator";
import { writeQueue, useWriteQueueSync } from "@/lib/write-queue";
import { createClient } from "@/lib/supabase/client";
import {
  computeScheduledDepartures,
  currentRiderIndex,
  ttSessionChannel,
  TT_STARTED_EVENT,
  type ScheduledRiderInput,
} from "@/lib/tt-live";

// Register the route handler the queued Start write flushes to. Done at module
// load (idempotent) so the registry is populated before the first enqueue.
function startEndpoint(slug: string, stageNumber: number): string {
  return `/api/races/${slug}/stages/${stageNumber}/live/tt/start`;
}

export type TtStartLineRider = {
  registration_id: string;
  position: number;
  start_time: string | null;
  bib_number: number | null;
  rider_name: string;
  category_id: string;
  category_name: string;
};

type Props = {
  slug: string;
  stageNumber: number;
  stageId: string;
  stageName: string;
  stageDateLabel: string;
  firstStartLabel: string | null;
  intervalSeconds: number | null;
  categoryGapSeconds: number | null;
  riders: TtStartLineRider[];
  /** `started_at` of an already-started session, or null. Resumes live state. */
  initialAnchor: string | null;
};

const QUEUE_TIP_STORAGE_KEY = "tt_wakelock_tip_dismissed";

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "HH:mm:ss", { locale: es });
}

export function TtStartLineView({
  slug,
  stageNumber,
  stageId,
  stageName,
  stageDateLabel,
  firstStartLabel,
  intervalSeconds,
  categoryGapSeconds,
  riders,
  initialAnchor,
}: Props) {
  // Drive the write-queue 60s retry loop from this live view (Story 15 boundary).
  useWriteQueueSync();

  // The authoritative session anchor (ISO). Null until Start is pressed.
  const [anchor, setAnchor] = useState<string | null>(initialAnchor);

  // Live clock — ticks every 250ms while a session is running.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Wake Lock tip visibility (shown once if wake lock is unavailable/denied).
  const [showWakeTip, setShowWakeTip] = useState(false);

  // Accidental-start protection (Story 17 usability):
  //  - `confirmOpen` gates `handleStart` behind a confirmation dialog.
  //  - `showUndo` exposes a short-lived "undo start" escape right after starting.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showUndo, setShowUndo] = useState(false);

  // ---------------------------------------------------------------------------
  // Endpoint registration (once)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    writeQueue.registerEndpoint(
      "stage_category_starts",
      "upsert",
      startEndpoint(slug, stageNumber),
    );
  }, [slug, stageNumber]);

  // ---------------------------------------------------------------------------
  // Scheduled departures (re-anchored planned times)
  // ---------------------------------------------------------------------------
  const scheduled = useMemo(() => {
    if (!anchor) return [];
    const inputs: ScheduledRiderInput[] = riders.map((r) => ({
      registration_id: r.registration_id,
      position: r.position,
      start_time: r.start_time,
      bib_number: r.bib_number,
      rider_name: r.rider_name,
      category_id: r.category_id,
      category_name: r.category_name,
    }));
    return computeScheduledDepartures(inputs, anchor);
  }, [anchor, riders]);

  // ---------------------------------------------------------------------------
  // Live clock tick (only while a session is running)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!anchor) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [anchor]);

  // ---------------------------------------------------------------------------
  // Wake Lock — request on mount + re-request on visibility regain
  // ---------------------------------------------------------------------------
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      // Unsupported — surface the one-time tip (unless previously dismissed).
      if (
        typeof window !== "undefined" &&
        window.localStorage.getItem(QUEUE_TIP_STORAGE_KEY) !== "1"
      ) {
        setShowWakeTip(true);
      }
      return;
    }
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      // Denied / failed — show the dismissible tip (unless previously dismissed).
      if (
        typeof window !== "undefined" &&
        window.localStorage.getItem(QUEUE_TIP_STORAGE_KEY) !== "1"
      ) {
        setShowWakeTip(true);
      }
    }
  }, []);

  useEffect(() => {
    // Defer the initial request out of the effect body so any resulting
    // setState (the unsupported/denied tip) doesn't run synchronously.
    const initialRequest = window.setTimeout(() => {
      void requestWakeLock();
    }, 0);

    const handleVisibility = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        wakeLockRef.current === null
      ) {
        void requestWakeLock();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      window.clearTimeout(initialRequest);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      if (sentinel) void sentinel.release().catch(() => {});
    };
  }, [requestWakeLock]);

  const dismissWakeTip = useCallback(() => {
    setShowWakeTip(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(QUEUE_TIP_STORAGE_KEY, "1");
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Start TT
  // ---------------------------------------------------------------------------
  const handleStart = useCallback(() => {
    const startedAt = new Date().toISOString();

    // Queue the anchor write (flushes to the registered endpoint). `captured_at`
    // is added by the queue and is the authoritative anchor server-side.
    writeQueue.enqueue({
      table: "stage_category_starts",
      operation: "upsert",
      payload: { stage_id: stageId },
    });

    // Broadcast so the finish-line view (Story 18) syncs the anchor instantly.
    try {
      const supabase = createClient();
      const channel = supabase.channel(ttSessionChannel(stageId));
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.send({
            type: "broadcast",
            event: TT_STARTED_EVENT,
            payload: { stage_id: stageId, started_at: startedAt },
          });
        }
      });
    } catch {
      // Broadcast is best-effort; the durable write is the queued one above.
    }

    setAnchor(startedAt);
    // Open the short undo window so an accidental start can be reverted.
    setShowUndo(true);
  }, [stageId]);

  // Revert an accidental start back to the pre-start screen.
  //
  // The write queue exposes no removal/cancel API (see `lib/write-queue.ts` —
  // only enqueue/flush/subscribe/getState/registerEndpoint are public), so we
  // cannot pull the already-queued start write out of the queue. Instead we keep
  // the undo purely client-side: resetting `anchor` to null shows the pre-start
  // screen again, and re-pressing "Iniciar contrarreloj" re-enqueues the start.
  // That write is an idempotent `upsert` keyed by stage, so the re-press simply
  // overwrites the previous anchor server-side with the new one.
  const handleUndoStart = useCallback(() => {
    // Best-effort: re-broadcast a fresh start event on the next real start.
    // Here we only revert local state so the operator can start again cleanly.
    setShowUndo(false);
    setAnchor(null);
  }, []);

  // Auto-dismiss the undo control after a short window.
  useEffect(() => {
    if (!showUndo) return;
    const id = window.setTimeout(() => setShowUndo(false), 10_000);
    return () => window.clearTimeout(id);
  }, [showUndo]);

  const hasStartOrder = riders.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <ConnectivityIndicator />
      <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 pt-10 pb-6">
        {showWakeTip && (
          <div
            role="status"
            className="flex items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          >
            <span>
              Consejo: desactiva el bloqueo automático de este dispositivo para
              mantener esta pantalla encendida.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={dismissWakeTip}
              aria-label="Descartar consejo"
            >
              Entendido
            </Button>
          </div>
        )}

        {!anchor ? (
          <PreStart
            stageName={stageName}
            stageDateLabel={stageDateLabel}
            firstStartLabel={firstStartLabel}
            intervalSeconds={intervalSeconds}
            categoryGapSeconds={categoryGapSeconds}
            hasStartOrder={hasStartOrder}
            riders={riders}
            onStart={() => setConfirmOpen(true)}
          />
        ) : (
          <LiveCountdown
            stageName={stageName}
            scheduled={scheduled}
            nowMs={nowMs}
            showUndo={showUndo}
            onUndoStart={handleUndoStart}
          />
        )}
      </main>

      {/* Confirmation step — guards against an accidental anchor (Story 17). */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Iniciar la contrarreloj?</AlertDialogTitle>
            <AlertDialogDescription>
              El cronómetro se anclará a este momento y definirá las horas de
              salida de todos los corredores. Hazlo cuando salga el primer
              corredor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleStart}>Iniciar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pre-start state
// ---------------------------------------------------------------------------

// Format an ISO `start_time` string as `HH:mm:ss` (es locale), or "—" when the
// value is null/unparseable. Mirrors `formatClock` but for ISO inputs (the
// pre-start preview uses the configured planned times directly, not ms anchors).
function formatPlannedClock(startTime: string | null): string {
  if (!startTime) return "—";
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "HH:mm:ss", { locale: es });
}

function PreStart({
  stageName,
  stageDateLabel,
  firstStartLabel,
  intervalSeconds,
  categoryGapSeconds,
  hasStartOrder,
  riders,
  onStart,
}: {
  stageName: string;
  stageDateLabel: string;
  firstStartLabel: string | null;
  intervalSeconds: number | null;
  categoryGapSeconds: number | null;
  hasStartOrder: boolean;
  riders: TtStartLineRider[];
  onStart: () => void;
}) {
  // Preview the first riders due to start, by `position` ascending. We take the
  // first 5 by position regardless of `start_time` (rendering "—" for missing
  // times) so the preview faithfully mirrors the start order's leading rows.
  const firstRiders = [...riders]
    .sort((a, b) => a.position - b.position)
    .slice(0, 5);

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{stageName}</h1>
        <p className="capitalize text-muted-foreground">{stageDateLabel}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración de salida</CardTitle>
          <CardDescription>
            Cuando salga el primer corredor, presiona Iniciar contrarreloj.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ConfigItem
            label="Salida del primer corredor"
            value={firstStartLabel ?? "—"}
          />
          <ConfigItem
            label="Intervalo entre corredores"
            value={intervalSeconds != null ? `${intervalSeconds} s` : "—"}
          />
          <ConfigItem
            label="Intervalo entre categorías"
            value={categoryGapSeconds != null ? `${categoryGapSeconds} s` : "—"}
          />
        </CardContent>
      </Card>

      {hasStartOrder ? (
        <Button
          type="button"
          size="lg"
          className="h-32 w-full text-3xl font-bold"
          onClick={onStart}
        >
          Iniciar contrarreloj
        </Button>
      ) : (
        <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          Aún no se ha generado el orden de salida de esta etapa. Genéralo antes
          de iniciar la salida en vivo.
        </p>
      )}

      {/* Preview: first riders due to start (read-only, pre-start only). */}
      {hasStartOrder && firstRiders.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Primeros en salir
          </h2>
          <ul className="flex flex-col gap-2">
            {firstRiders.map((r, i) => (
              <li
                key={r.registration_id}
                className={cn(
                  "flex items-center gap-4 rounded-lg border px-4",
                  i === 0
                    ? "border-primary/40 bg-primary/5 py-4 text-lg"
                    : "border-border py-3 text-base",
                )}
              >
                <span className="w-20 shrink-0 font-semibold tabular-nums text-muted-foreground">
                  {formatPlannedClock(r.start_time)}
                </span>
                <span className="w-12 shrink-0 font-bold tabular-nums">
                  {r.bib_number ?? "—"}
                </span>
                <span className="flex-1 truncate font-medium">
                  {r.rider_name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {r.category_name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live countdown state
// ---------------------------------------------------------------------------

function LiveCountdown({
  stageName,
  scheduled,
  nowMs,
  showUndo,
  onUndoStart,
}: {
  stageName: string;
  scheduled: ReturnType<typeof computeScheduledDepartures>;
  nowMs: number;
  showUndo: boolean;
  onUndoStart: () => void;
}) {
  const idx = currentRiderIndex(scheduled, nowMs);
  const finished = idx >= scheduled.length;

  // Flash window: briefly highlight when a rider departs (countdown hit zero).
  // We treat the 800ms after a scheduled departure as the flash window.
  const lastDeparted = useMemo(() => {
    let last: (typeof scheduled)[number] | null = null;
    for (const r of scheduled) {
      if (r.scheduledAt <= nowMs) last = r;
    }
    return last;
  }, [scheduled, nowMs]);

  const flashing =
    lastDeparted != null && nowMs - lastDeparted.scheduledAt < 800;

  // Short-lived "undo start" escape, shown for a few seconds after starting so
  // an accidental start can be reverted to the pre-start screen.
  const undoNotice = showUndo ? (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-3 text-sm"
    >
      <span className="text-muted-foreground">¿Iniciaste por error?</span>
      <Button type="button" size="sm" variant="outline" onClick={onUndoStart}>
        Deshacer inicio
      </Button>
    </div>
  ) : null;

  if (scheduled.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {undoNotice}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <h1 className="text-2xl font-semibold">{stageName}</h1>
          <p className="text-muted-foreground">
            No hay corredores con hora de salida en el orden de esta etapa.
          </p>
        </div>
      </div>
    );
  }

  if (finished) {
    const last = scheduled[scheduled.length - 1];
    return (
      <div className="flex flex-1 flex-col gap-6">
        {undoNotice}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">{stageName}</h1>
          <p className="text-4xl font-bold">Todos los corredores han salido</p>
          <p className="text-xl text-muted-foreground">
            Última salida a las {formatClock(last.scheduledAt)}
          </p>
        </div>
      </div>
    );
  }

  const current = scheduled[idx];
  const secondsToNext = (current.scheduledAt - nowMs) / 1000;
  const upcoming = scheduled.slice(idx + 1, idx + 6);

  return (
    <div className="flex flex-1 flex-col gap-6">
      {undoNotice}
      {/* Primary: countdown + current rider */}
      <div
        className={cn(
          "flex flex-col items-center gap-4 rounded-xl border py-8 transition-colors",
          flashing
            ? "border-green-500 bg-green-500/10"
            : "border-border bg-card",
        )}
      >
        <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Próxima salida en
        </span>
        <span className="text-[5rem] font-bold leading-none tabular-nums sm:text-[8rem]">
          {formatCountdown(secondsToNext)}
        </span>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-baseline gap-3">
            <span className="text-5xl font-bold tabular-nums">
              {current.bib_number ?? "—"}
            </span>
            <span className="text-3xl font-semibold">{current.rider_name}</span>
          </div>
          <span className="text-lg text-muted-foreground">
            {current.category_name} · salida {formatClock(current.scheduledAt)}
          </span>
        </div>
      </div>

      {/* Queue: next 5 riders */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          A continuación
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay más corredores en cola.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((r, i) => (
              <li
                key={r.registration_id}
                className={cn(
                  "flex items-center gap-4 rounded-lg border px-4",
                  i === 0
                    ? "border-primary/40 bg-primary/5 py-4 text-lg"
                    : "border-border py-3 text-base",
                )}
              >
                <span className="w-20 shrink-0 font-semibold tabular-nums text-muted-foreground">
                  {formatClock(r.scheduledAt)}
                </span>
                <span className="w-12 shrink-0 font-bold tabular-nums">
                  {r.bib_number ?? "—"}
                </span>
                <span className="flex-1 truncate font-medium">
                  {r.rider_name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {r.category_name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

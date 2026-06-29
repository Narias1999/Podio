"use client";

// Story 18 — TT finish-line view.
//
// One operator opens this at the finish gate. While waiting it shows a
// pre-session state until the start-line view (Story 17) broadcasts the session
// anchor (Realtime) — or until an anchor already exists server-side. Once live:
//   - a running elapsed timer ticks every second (Date.now() − anchor), never
//     blocked by the network;
//   - a huge STOP button captures `finish_at = Date.now()` BEFORE any async
//     work, creates a pending entry, and fires beep/vibrate feedback;
//   - each pending entry takes a bib number and is saved via the write queue
//     (Story 15) → the registered `results` finish endpoint. Invalid bibs show
//     an inline error; duplicates ask to overwrite.
//
// Pending (captured-but-unassigned) entries live in their own localStorage key
// (`tt_finish_pending:<stageId>`) — distinct from the write queue's own key —
// so a refresh never loses a captured time.
//
// Shared infra (Stories 15/16): `useWriteQueueSync()` drives the 60s retry
// loop; `<ConnectivityIndicator />` is the fixed top bar with a `pt-10` wrapper
// so it never covers STOP. NO privileged client writes — saves go through the
// queue → POST route handler. Realtime subscribe uses the anon browser client
// (read-only notify, allowed).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ConnectivityIndicator } from "@/components/connectivity-indicator";
import { writeQueue, useWriteQueueSync } from "@/lib/write-queue";
import { createClient } from "@/lib/supabase/client";
import {
  computeScheduledDepartures,
  ttSessionChannel,
  TT_STARTED_EVENT,
  type TtStartedPayload,
} from "@/lib/tt-live";

/** An in-progress (en pista) rider: started but not yet finished. */
type InProgressRider = {
  registration_id: string;
  bib_number: number;
  rider_name: string;
  category_name: string;
  /** Scheduled departure as ms epoch (start order). */
  scheduledAt: number;
};

export type TtFinishLineRider = {
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
  resultsLocked: boolean;
  riders: TtFinishLineRider[];
  /** `started_at` of an already-started session, or null. */
  initialAnchor: string | null;
  /** Bibs that already had a saved result at page load. */
  initialSavedBibs: number[];
};

/** A captured-but-unassigned finish (persisted to localStorage). */
type PendingEntry = {
  id: string;
  /** Absolute finish instant captured at STOP (ms epoch). */
  finishMs: number;
  /** Operator-typed bib text (kept so a refresh preserves a half-typed bib). */
  bibInput: string;
};

function finishEndpoint(slug: string, stageNumber: number): string {
  return `/api/races/${slug}/stages/${stageNumber}/live/tt/finish`;
}

function pendingStorageKey(stageId: string): string {
  return `tt_finish_pending:${stageId}`;
}

/** Formats an elapsed millisecond duration as `H:MM:SS`. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Short beep via Web Audio + vibrate, both guarded for support. */
function fireFeedback(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.1;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => {
        void ctx.close().catch(() => {});
      };
    }
  } catch {
    // Audio unavailable / blocked — vibration still attempted below.
  }
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(80);
    }
  } catch {
    // Ignore — vibration is best-effort.
  }
}

export function TtFinishLineView({
  slug,
  stageNumber,
  stageId,
  stageName,
  resultsLocked,
  riders,
  initialAnchor,
  initialSavedBibs,
}: Props) {
  // Own the write-queue 60s retry loop from this live view (Story 15 boundary).
  useWriteQueueSync();
  const router = useRouter();

  // Session anchor (ISO). Null until the start line broadcasts / a row exists.
  const [anchor, setAnchor] = useState<string | null>(initialAnchor);
  const anchorMs = useMemo(
    () => (anchor ? new Date(anchor).getTime() : null),
    [anchor],
  );

  // Live clock — ticks every second while a session is running.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Pending (captured-but-unassigned) finishes, most-recent-first.
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [restored, setRestored] = useState(false);

  // Per-entry inline state.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});

  // Bibs already assigned a result (server-known + assigned this session).
  const [savedBibs, setSavedBibs] = useState<Set<number>>(
    () => new Set(initialSavedBibs),
  );

  // Overwrite confirmation dialog for a duplicate bib.
  const [overwrite, setOverwrite] = useState<{
    entryId: string;
    bib: number;
  } | null>(null);

  // Discard confirmation dialog for a single pending entry.
  const [discardId, setDiscardId] = useState<string | null>(null);

  // End-session confirmation dialog.
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  // Valid bib → rider lookup (for client-side validation before enqueueing).
  const ridersByBib = useMemo(() => {
    const map = new Map<number, TtFinishLineRider>();
    for (const r of riders) {
      if (r.bib_number !== null) map.set(r.bib_number, r);
    }
    return map;
  }, [riders]);

  // Scheduled departures, re-anchored to the live session anchor (start order).
  const scheduled = useMemo(
    () =>
      anchorMs != null
        ? computeScheduledDepartures(
            riders.map((r) => ({
              registration_id: r.registration_id,
              position: r.position,
              start_time: r.start_time,
              bib_number: r.bib_number,
              rider_name: r.rider_name,
              category_id: r.category_id,
              category_name: r.category_name,
            })),
            anchor!,
          )
        : [],
    [anchor, anchorMs, riders],
  );

  // Riders "en pista": have started (scheduledAt <= now) but not yet finished
  // (their bib is not in savedBibs). Kept in start order (ascending scheduledAt).
  const inProgress = useMemo<InProgressRider[]>(() => {
    return scheduled
      .filter(
        (r) =>
          r.bib_number != null &&
          r.scheduledAt <= nowMs &&
          !savedBibs.has(r.bib_number),
      )
      .map((r) => ({
        registration_id: r.registration_id,
        bib_number: r.bib_number as number,
        rider_name: r.rider_name,
        category_name: r.category_name,
        scheduledAt: r.scheduledAt,
      }));
  }, [scheduled, nowMs, savedBibs]);

  // ---------------------------------------------------------------------------
  // Endpoint registration (once)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    writeQueue.registerEndpoint(
      "results",
      "upsert",
      finishEndpoint(slug, stageNumber),
    );
  }, [slug, stageNumber]);

  // ---------------------------------------------------------------------------
  // Restore persisted pending entries on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Defer out of the effect body so the restore setState doesn't run
    // synchronously (avoids a cascading render).
    const timer = window.setTimeout(() => {
      let restoredEntries: PendingEntry[] | null = null;
      try {
        const raw = window.localStorage.getItem(pendingStorageKey(stageId));
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            restoredEntries = (parsed as PendingEntry[]).filter(
              (e) =>
                e &&
                typeof e.id === "string" &&
                typeof e.finishMs === "number" &&
                typeof e.bibInput === "string",
            );
          }
        }
      } catch {
        // Corrupt storage — start clean.
      }
      if (restoredEntries && restoredEntries.length > 0) {
        setPending(restoredEntries);
      }
      setRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stageId]);

  // Persist pending entries whenever they change (after the initial restore).
  useEffect(() => {
    if (!restored || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        pendingStorageKey(stageId),
        JSON.stringify(pending),
      );
    } catch {
      // Storage full / unavailable — nothing safe to do.
    }
  }, [pending, restored, stageId]);

  // ---------------------------------------------------------------------------
  // Live clock tick (only while a session is running)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!anchor) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anchor]);

  // ---------------------------------------------------------------------------
  // Realtime: learn the anchor the instant the start line presses Start
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (anchor) return; // Already live — no need to subscribe.
    const supabase = createClient();
    const channel = supabase
      .channel(ttSessionChannel(stageId))
      .on("broadcast", { event: TT_STARTED_EVENT }, (message) => {
        const payload = message.payload as Partial<TtStartedPayload> | undefined;
        if (
          payload &&
          payload.stage_id === stageId &&
          typeof payload.started_at === "string"
        ) {
          setAnchor(payload.started_at);
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [anchor, stageId]);

  // ---------------------------------------------------------------------------
  // STOP — capture instant FIRST, then create a pending entry + feedback
  // ---------------------------------------------------------------------------
  const handleStop = useCallback(() => {
    const finishMs = Date.now(); // Captured before any async work.
    const entry: PendingEntry = { id: randomId(), finishMs, bibInput: "" };
    setPending((prev) => [entry, ...prev]);
    fireFeedback();
  }, []);

  // ---------------------------------------------------------------------------
  // Save a pending entry → enqueue the result write
  // ---------------------------------------------------------------------------
  const commitSave = useCallback(
    (entry: PendingEntry, bib: number) => {
      setSavingIds((prev) => ({ ...prev, [entry.id]: true }));
      writeQueue.enqueue({
        table: "results",
        operation: "upsert",
        payload: {
          stage_id: stageId,
          bib_number: bib,
          finish_at: new Date(entry.finishMs).toISOString(),
        },
      });
      setSavedBibs((prev) => new Set(prev).add(bib));
      // Remove the card optimistically — the queue handles delivery/retries and
      // the connectivity indicator surfaces any sync failure.
      setPending((prev) => prev.filter((e) => e.id !== entry.id));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      setSavingIds((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
    },
    [stageId],
  );

  const handleSave = useCallback(
    (entry: PendingEntry) => {
      const trimmed = entry.bibInput.trim();
      const bib = Number.parseInt(trimmed, 10);
      if (trimmed === "" || !Number.isInteger(bib) || bib < 0) {
        setErrors((prev) => ({
          ...prev,
          [entry.id]: "Escribe un dorsal válido.",
        }));
        return;
      }
      if (!ridersByBib.has(bib)) {
        setErrors((prev) => ({
          ...prev,
          [entry.id]: `El dorsal ${bib} no está en la lista de salida.`,
        }));
        return;
      }
      if (savedBibs.has(bib)) {
        // Duplicate — confirm overwrite before committing.
        setOverwrite({ entryId: entry.id, bib });
        return;
      }
      commitSave(entry, bib);
    },
    [ridersByBib, savedBibs, commitSave],
  );

  const handleBibChange = useCallback((id: string, value: string) => {
    // Numeric only.
    const cleaned = value.replace(/[^0-9]/g, "");
    setPending((prev) =>
      prev.map((e) => (e.id === id ? { ...e, bibInput: cleaned } : e)),
    );
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const confirmOverwrite = useCallback(() => {
    if (!overwrite) return;
    const entry = pending.find((e) => e.id === overwrite.entryId);
    if (entry) commitSave(entry, overwrite.bib);
    setOverwrite(null);
  }, [overwrite, pending, commitSave]);

  // Discard a single pending entry — clears its inline error/saving state and
  // removes it from `pending` (the persistence effect updates localStorage).
  const confirmDiscard = useCallback(() => {
    if (discardId) {
      setPending((prev) => prev.filter((e) => e.id !== discardId));
      setErrors((prev) => {
        if (!(discardId in prev)) return prev;
        const next = { ...prev };
        delete next[discardId];
        return next;
      });
      setSavingIds((prev) => {
        if (!(discardId in prev)) return prev;
        const next = { ...prev };
        delete next[discardId];
        return next;
      });
    }
    setDiscardId(null);
  }, [discardId]);

  // ---------------------------------------------------------------------------
  // End session → lock the stage's results (completable state)
  // ---------------------------------------------------------------------------
  const handleEndSession = useCallback(async () => {
    setEnding(true);
    setEndError(null);
    try {
      const response = await fetch(
        `/api/races/${slug}/stages/${stageNumber}/complete`,
        { method: "POST" },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setEndError(
          data?.error ??
            "No se pudo finalizar la sesión. Inténtalo de nuevo.",
        );
        setEnding(false);
        return;
      }
      setEndOpen(false);
      setEnding(false);
      router.push(`/races/${slug}/stages/${stageNumber}/results`);
      router.refresh();
    } catch {
      setEndError("No se pudo finalizar la sesión. Inténtalo de nuevo.");
      setEnding(false);
    }
  }, [slug, stageNumber, router]);

  const elapsed = anchorMs !== null ? nowMs - anchorMs : 0;
  const overwriteRider = overwrite ? ridersByBib.get(overwrite.bib) : undefined;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <ConnectivityIndicator />
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 pt-10 pb-6">
        {!anchor ? (
          <WaitingForStart />
        ) : (
          <>
            {/* Top bar: elapsed timer + end-session control */}
            <header className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {stageName}
                </span>
                <span
                  className="text-4xl font-bold tabular-nums sm:text-5xl"
                  aria-label="Tiempo transcurrido"
                  suppressHydrationWarning
                >
                  {formatElapsed(elapsed)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <InProgressSheet riders={inProgress} nowMs={nowMs} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEndError(null);
                    setEndOpen(true);
                  }}
                  disabled={resultsLocked}
                >
                  {resultsLocked ? "Sesión finalizada" : "Finalizar sesión"}
                </Button>
              </div>
            </header>

            {/* STOP — ≥40% of viewport height, never disabled */}
            <Button
              type="button"
              onClick={handleStop}
              className="h-[40vh] w-full text-6xl font-black tracking-wider"
            >
              STOP
            </Button>

            {/* Pending entries — reverse chronological, resolve in any order */}
            <section className="flex flex-col gap-3" aria-label="Llegadas por asignar">
              {pending.length === 0 ? (
                <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
                  No hay llegadas por asignar. Presiona STOP cuando un corredor
                  cruce la meta.
                </p>
              ) : (
                pending.map((entry) => (
                  <PendingCard
                    key={entry.id}
                    entry={entry}
                    elapsedLabel={
                      anchorMs !== null
                        ? formatElapsed(entry.finishMs - anchorMs)
                        : "—"
                    }
                    error={errors[entry.id] ?? null}
                    saving={savingIds[entry.id] ?? false}
                    availableRiders={inProgress}
                    onBibChange={handleBibChange}
                    onSave={handleSave}
                    onDiscard={(id) => setDiscardId(id)}
                  />
                ))
              )}
            </section>
          </>
        )}
      </main>

      {/* Duplicate-bib overwrite confirmation */}
      <AlertDialog
        open={overwrite !== null}
        onOpenChange={(open) => {
          if (!open) setOverwrite(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {overwrite
                ? `El dorsal ${overwrite.bib} ya tiene un tiempo registrado — ¿sobrescribir?`
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {overwriteRider
                ? `Se reemplazará el tiempo de ${overwriteRider.rider_name} con la llegada capturada.`
                : "Se reemplazará el tiempo registrado anteriormente."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmOverwrite}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard confirmation for a single pending entry */}
      <AlertDialog
        open={discardId !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar esta llegada?</AlertDialogTitle>
            <AlertDialogDescription>
              El tiempo capturado se perderá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* End-session confirmation (warns about unresolved entries) */}
      <AlertDialog
        open={endOpen}
        onOpenChange={(open) => {
          if (!ending) setEndOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar sesión</AlertDialogTitle>
            <AlertDialogDescription>
              {pending.length > 0
                ? `Tienes ${pending.length} ${
                    pending.length === 1 ? "entrada" : "entradas"
                  } sin asignar. Termina de asignar los dorsales antes de finalizar la sesión.`
                : "Se marcará la etapa como completada y sus resultados quedarán bloqueados."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {endError && (
            <p className="text-sm text-destructive" role="alert">
              {endError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (pending.length > 0) return; // Blocked until all assigned.
                void handleEndSession();
              }}
              disabled={ending || pending.length > 0}
            >
              {ending ? "Finalizando…" : "Finalizar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pre-session state
// ---------------------------------------------------------------------------

function WaitingForStart() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      <Spinner className="size-8 text-muted-foreground" />
      <p className="text-lg font-medium text-muted-foreground">
        Esperando a que la línea de salida inicie la sesión…
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending entry card
// ---------------------------------------------------------------------------

function PendingCard({
  entry,
  elapsedLabel,
  error,
  saving,
  availableRiders,
  onBibChange,
  onSave,
  onDiscard,
}: {
  entry: PendingEntry;
  elapsedLabel: string;
  error: string | null;
  saving: boolean;
  availableRiders: InProgressRider[];
  onBibChange: (id: string, value: string) => void;
  onSave: (entry: PendingEntry) => void;
  onDiscard: (id: string) => void;
}) {
  // Local open state for the autocomplete dropdown.
  const [open, setOpen] = useState(false);

  // Filter the in-progress riders by what the operator has typed: prefix match
  // on the bib number (as a string). Empty input shows all available riders.
  const typed = entry.bibInput.trim();
  const suggestions = useMemo(() => {
    if (typed === "") return availableRiders;
    return availableRiders.filter((r) =>
      String(r.bib_number).startsWith(typed),
    );
  }, [availableRiders, typed]);

  const showDropdown = open && suggestions.length > 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card px-4 py-3",
        error ? "border-destructive" : "border-border",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className="w-28 shrink-0 text-2xl font-bold tabular-nums"
          suppressHydrationWarning
        >
          {elapsedLabel}
        </span>
        {/* Relatively-positioned wrapper so the suggestion list can anchor to
            the input directly below it. */}
        <div className="relative flex-1">
          <Input
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder="Dorsal"
            aria-label="Número de dorsal"
            role="combobox"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            value={entry.bibInput}
            onChange={(e) => onBibChange(entry.id, e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Delay so a pointerdown on a suggestion still fires first.
              window.setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setOpen(false);
                onSave(entry);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            className="h-12 w-full text-lg"
          />
          {showDropdown && (
            <ul
              role="listbox"
              aria-label="Corredores en pista"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg"
            >
              {suggestions.map((rider) => (
                <li key={rider.registration_id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    aria-label={`Dorsal ${rider.bib_number}, ${rider.rider_name}`}
                    // Use pointerdown (not click) so selection registers BEFORE
                    // the input's blur hides the list; preventDefault keeps focus.
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onBibChange(entry.id, String(rider.bib_number));
                      setOpen(false);
                    }}
                    className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none"
                  >
                    <span className="font-bold tabular-nums">
                      #{rider.bib_number}
                    </span>
                    <span className="flex-1 truncate">{rider.rider_name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {rider.category_name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => onDiscard(entry.id)}
          disabled={saving}
          className="h-12 shrink-0 px-4 text-base"
        >
          Descartar
        </Button>
        <Button
          type="button"
          onClick={() => onSave(entry)}
          disabled={saving}
          className="h-12 shrink-0 px-6 text-base"
        >
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Corredores en pista" sheet — riders who have started but not yet finished
// ---------------------------------------------------------------------------

function InProgressSheet({
  riders,
  nowMs,
}: {
  riders: InProgressRider[];
  nowMs: number;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          En pista ({riders.length})
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh]">
        <SheetHeader>
          <SheetTitle>Corredores en pista</SheetTitle>
          <SheetDescription>
            Corredores que ya salieron y aún no tienen tiempo registrado, en
            orden de salida.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-auto px-4 pb-4">
          {riders.length === 0 ? (
            <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
              No hay corredores en pista.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {riders.map((rider, index) => (
                <li
                  key={rider.registration_id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                >
                  <span className="w-6 shrink-0 text-center text-sm font-medium text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <span className="shrink-0 text-lg font-bold tabular-nums">
                    #{rider.bib_number}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {rider.rider_name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {rider.category_name}
                    </span>
                  </div>
                  <span
                    className="shrink-0 text-xl font-bold tabular-nums"
                    suppressHydrationWarning
                  >
                    {formatElapsed(nowMs - rider.scheduledAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

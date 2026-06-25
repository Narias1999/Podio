"use client";

// Story 21 — Group/road-stage finish-line view.
//
// One operator opens this at the finish gate. While waiting it shows a
// pre-session state until the start-line view (Story 20) broadcasts a wave
// (Realtime `group-started`) — or until a `stage_category_starts` row already
// exists server-side. Once live:
//   - a running elapsed timer ticks every second (Date.now() − the EARLIEST
//     wave's `started_at`), never blocked by the network. Per-rider net time is
//     computed server-side against each rider's OWN category wave start, so a
//     mixed-category group is handled correctly even though the on-screen timer
//     uses the earliest wave;
//   - a huge STOP button captures `finish_at = Date.now()` BEFORE any async
//     work, creates a pending GROUP entry, and fires beep/vibrate feedback;
//   - each pending entry is a group: the operator types bibs (each becomes a
//     reorderable chip setting within-group order), then taps "Guardar grupo".
//     Saving enqueues ONE result write per rider (shared captured time + their
//     1-based `group_position`) through the write queue (Story 15) → the group
//     finish endpoint.
//
// Pending (captured-but-unsaved) groups live in their own localStorage key
// (`group_finish_pending:<stageId>`) — distinct from the write queue's own key
// and from the TT finish key — so a refresh never loses a captured time.
//
// Write-queue endpoint routing: each rider write is enqueued with an explicit
// `endpoint` override (same approach as Story 20's group-start) pointing to the
// group-finish route, so `results:upsert` never collides with the TT finish
// endpoint the global registry maps that pair to. See Story 15
// `QueueEntry.endpoint`.
//
// Shared infra (Stories 15/16): `useWriteQueueSync()` drives the 60s retry
// loop; `<ConnectivityIndicator />` is the fixed top bar with a `pt-10` wrapper
// so it never covers STOP. NO privileged client writes — saves go through the
// queue → POST route handler. Realtime subscribe uses the anon browser client
// (read-only notify, allowed). No DnD library is installed, so within-group
// reordering uses left/right move buttons rather than adding a heavy dependency.

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { cn } from "@/lib/utils";
import { ConnectivityIndicator } from "@/components/connectivity-indicator";
import { writeQueue, useWriteQueueSync } from "@/lib/write-queue";
import { createClient } from "@/lib/supabase/client";
import {
  groupSessionChannel,
  GROUP_STARTED_EVENT,
  type GroupStartedPayload,
} from "@/lib/group-live";

export type GroupFinishRider = {
  registration_id: string;
  bib_number: number;
  category_id: string;
  rider_name: string;
  category_name: string;
};

type Props = {
  slug: string;
  stageNumber: number;
  stageId: string;
  stageName: string;
  resultsLocked: boolean;
  riders: GroupFinishRider[];
  /** Earliest wave `started_at` (ISO) of an already-started session, or null. */
  initialAnchor: string | null;
  /** Bibs that already had a saved result at page load. */
  initialSavedBibs: number[];
};

/** A bib confirmed into a pending group. */
type GroupBib = {
  bib: number;
  /** True if this bib already had a saved result (in another group / stage). */
  alreadyRecorded: boolean;
};

/** A captured-but-unsaved group finish (persisted to localStorage). */
type PendingGroup = {
  id: string;
  /** Absolute finish instant captured at STOP (ms epoch). */
  finishMs: number;
  /** Bibs in within-group order (index 0 = position 1). */
  bibs: GroupBib[];
  /** Operator-typed bib text (kept so a refresh preserves a half-typed bib). */
  bibInput: string;
};

function finishEndpoint(slug: string, stageNumber: number): string {
  return `/api/races/${slug}/stages/${stageNumber}/live/group/finish`;
}

function pendingStorageKey(stageId: string): string {
  return `group_finish_pending:${stageId}`;
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

export function GroupFinishLineView({
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

  // Session anchor (ISO) — the EARLIEST wave's `started_at`. Null until the
  // start line broadcasts / a row exists. Drives the on-screen elapsed timer.
  const [anchor, setAnchor] = useState<string | null>(initialAnchor);
  const anchorMs = useMemo(
    () => (anchor ? new Date(anchor).getTime() : null),
    [anchor],
  );

  // Live clock — ticks every second while a session is running.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Pending groups, most-recent-first.
  const [pending, setPending] = useState<PendingGroup[]>([]);
  const [restored, setRestored] = useState(false);

  // Per-group inline state.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});

  // Bibs already assigned a result (server-known + saved this session).
  const [savedBibs, setSavedBibs] = useState<Set<number>>(
    () => new Set(initialSavedBibs),
  );

  // Overwrite confirmation for a group containing already-recorded bibs.
  const [overwriteGroupId, setOverwriteGroupId] = useState<string | null>(null);

  // Discard confirmation.
  const [discardGroupId, setDiscardGroupId] = useState<string | null>(null);

  // Valid bib → rider lookup (client-side validation before enqueueing).
  const ridersByBib = useMemo(() => {
    const map = new Map<number, GroupFinishRider>();
    for (const r of riders) map.set(r.bib_number, r);
    return map;
  }, [riders]);

  // ---------------------------------------------------------------------------
  // Restore persisted pending groups on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const timer = window.setTimeout(() => {
      let restoredGroups: PendingGroup[] | null = null;
      try {
        const raw = window.localStorage.getItem(pendingStorageKey(stageId));
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            restoredGroups = (parsed as PendingGroup[]).filter(
              (g) =>
                g &&
                typeof g.id === "string" &&
                typeof g.finishMs === "number" &&
                Array.isArray(g.bibs) &&
                typeof g.bibInput === "string",
            );
          }
        }
      } catch {
        // Corrupt storage — start clean.
      }
      if (restoredGroups && restoredGroups.length > 0) {
        setPending(restoredGroups);
      }
      setRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [stageId]);

  // Persist pending groups whenever they change (after the initial restore).
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
  // Realtime: learn the anchor the instant the start line presses Iniciar.
  // The earliest wave's `started_at` wins (multiple waves may arrive).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(groupSessionChannel(stageId))
      .on("broadcast", { event: GROUP_STARTED_EVENT }, (message) => {
        const payload = message.payload as
          | Partial<GroupStartedPayload>
          | undefined;
        if (
          payload &&
          payload.stage_id === stageId &&
          typeof payload.started_at === "string"
        ) {
          const startedAt = payload.started_at;
          setAnchor((prev) => {
            if (!prev) return startedAt;
            // Keep the earliest wave as the on-screen anchor.
            return new Date(startedAt).getTime() < new Date(prev).getTime()
              ? startedAt
              : prev;
          });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [stageId]);

  // ---------------------------------------------------------------------------
  // STOP — capture instant FIRST, then create a pending group + feedback
  // ---------------------------------------------------------------------------
  const handleStop = useCallback(() => {
    const finishMs = Date.now(); // Captured before any async work.
    const group: PendingGroup = {
      id: randomId(),
      finishMs,
      bibs: [],
      bibInput: "",
    };
    setPending((prev) => [group, ...prev]);
    fireFeedback();
  }, []);

  // ---------------------------------------------------------------------------
  // Bib entry
  // ---------------------------------------------------------------------------
  const setError = useCallback((id: string, message: string | null) => {
    setErrors((prev) => {
      if (message === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: message };
    });
  }, []);

  const flashNotice = useCallback((id: string, message: string) => {
    setNotices((prev) => ({ ...prev, [id]: message }));
    window.setTimeout(() => {
      setNotices((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 2000);
  }, []);

  const handleBibInputChange = useCallback(
    (id: string, value: string) => {
      const cleaned = value.replace(/[^0-9]/g, "");
      setPending((prev) =>
        prev.map((g) => (g.id === id ? { ...g, bibInput: cleaned } : g)),
      );
      setError(id, null);
    },
    [setError],
  );

  const handleAddBib = useCallback(
    (group: PendingGroup) => {
      const trimmed = group.bibInput.trim();
      if (trimmed === "") return;
      const bib = Number.parseInt(trimmed, 10);
      if (!Number.isInteger(bib) || bib < 0) {
        setError(group.id, "Escribe un dorsal válido.");
        return;
      }
      if (!ridersByBib.has(bib)) {
        setError(
          group.id,
          `El dorsal ${bib} no está registrado en esta carrera.`,
        );
        return;
      }
      if (group.bibs.some((b) => b.bib === bib)) {
        // Already in this group — silently ignore with a brief notice, clear
        // the field so the operator can type the next one.
        flashNotice(group.id, "Ya está en este grupo");
        setPending((prev) =>
          prev.map((g) => (g.id === group.id ? { ...g, bibInput: "" } : g)),
        );
        return;
      }
      const alreadyRecorded = savedBibs.has(bib);
      setPending((prev) =>
        prev.map((g) =>
          g.id === group.id
            ? {
                ...g,
                bibs: [...g.bibs, { bib, alreadyRecorded }],
                bibInput: "",
              }
            : g,
        ),
      );
      setError(group.id, null);
    },
    [ridersByBib, savedBibs, setError, flashNotice],
  );

  const handleRemoveBib = useCallback((groupId: string, bib: number) => {
    setPending((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, bibs: g.bibs.filter((b) => b.bib !== bib) }
          : g,
      ),
    );
  }, []);

  const handleMoveBib = useCallback(
    (groupId: string, index: number, direction: -1 | 1) => {
      setPending((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          const target = index + direction;
          if (target < 0 || target >= g.bibs.length) return g;
          const bibs = [...g.bibs];
          const [moved] = bibs.splice(index, 1);
          bibs.splice(target, 0, moved);
          return { ...g, bibs };
        }),
      );
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Save a group → enqueue one result write per rider
  // ---------------------------------------------------------------------------
  const commitSave = useCallback(
    (group: PendingGroup) => {
      const finishIso = new Date(group.finishMs).toISOString();
      const endpoint = finishEndpoint(slug, stageNumber);
      group.bibs.forEach((entry, index) => {
        writeQueue.enqueue({
          table: "results",
          operation: "upsert",
          payload: {
            stage_id: stageId,
            bib_number: entry.bib,
            finish_at: finishIso,
            group_position: index + 1,
          },
          // Explicit override — avoids colliding with the TT finish endpoint
          // registered globally for `results:upsert`.
          endpoint,
        });
      });
      setSavedBibs((prev) => {
        const next = new Set(prev);
        for (const entry of group.bibs) next.add(entry.bib);
        return next;
      });
      // Remove the card optimistically — the queue handles delivery/retries and
      // the connectivity indicator surfaces any sync failure.
      setPending((prev) => prev.filter((g) => g.id !== group.id));
      setError(group.id, null);
    },
    [slug, stageNumber, stageId, setError],
  );

  const handleSave = useCallback(
    (group: PendingGroup) => {
      if (group.bibs.length === 0) return;
      if (group.bibs.some((b) => b.alreadyRecorded)) {
        setOverwriteGroupId(group.id);
        return;
      }
      commitSave(group);
    },
    [commitSave],
  );

  const overwriteGroup = overwriteGroupId
    ? pending.find((g) => g.id === overwriteGroupId)
    : undefined;
  const overwriteBib = overwriteGroup?.bibs.find((b) => b.alreadyRecorded);

  const confirmOverwrite = useCallback(() => {
    if (overwriteGroup) commitSave(overwriteGroup);
    setOverwriteGroupId(null);
  }, [overwriteGroup, commitSave]);

  const confirmDiscard = useCallback(() => {
    if (discardGroupId) {
      setPending((prev) => prev.filter((g) => g.id !== discardGroupId));
      setError(discardGroupId, null);
    }
    setDiscardGroupId(null);
  }, [discardGroupId, setError]);

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
            {/* Top bar: stage name + elapsed timer */}
            <header className="flex flex-col">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {stageName}
              </span>
              <span
                className="text-4xl font-bold tabular-nums sm:text-5xl"
                aria-label="Tiempo transcurrido"
              >
                {formatElapsed(anchorMs !== null ? nowMs - anchorMs : 0)}
              </span>
              {resultsLocked && (
                <span className="mt-1 text-sm text-muted-foreground">
                  Los resultados de esta etapa están bloqueados.
                </span>
              )}
            </header>

            {/* STOP — large, never disabled */}
            <Button
              type="button"
              onClick={handleStop}
              className="h-[40vh] w-full text-6xl font-black tracking-wider"
            >
              STOP
            </Button>

            {/* Pending groups — reverse chronological, resolve in any order */}
            <section
              className="flex flex-col gap-3"
              aria-label="Grupos por asignar"
            >
              {pending.length === 0 ? (
                <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
                  No hay grupos por asignar. Presiona STOP cuando un grupo cruce
                  la meta.
                </p>
              ) : (
                pending.map((group) => (
                  <PendingGroupCard
                    key={group.id}
                    group={group}
                    elapsedLabel={
                      anchorMs !== null
                        ? formatElapsed(group.finishMs - anchorMs)
                        : "—"
                    }
                    error={errors[group.id] ?? null}
                    notice={notices[group.id] ?? null}
                    ridersByBib={ridersByBib}
                    onBibInputChange={handleBibInputChange}
                    onAddBib={handleAddBib}
                    onRemoveBib={handleRemoveBib}
                    onMoveBib={handleMoveBib}
                    onSave={handleSave}
                    onDiscard={(id) => setDiscardGroupId(id)}
                  />
                ))
              )}
            </section>
          </>
        )}
      </main>

      {/* Already-recorded bib overwrite confirmation */}
      <AlertDialog
        open={overwriteGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setOverwriteGroupId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {overwriteBib
                ? `El dorsal ${overwriteBib.bib} ya tiene un resultado en esta etapa. ¿Sobrescribir?`
                : "¿Sobrescribir resultado?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se reemplazará el resultado registrado anteriormente con la llegada
              capturada para este grupo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmOverwrite}>
              Sobrescribir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard confirmation */}
      <AlertDialog
        open={discardGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardGroupId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar este grupo?</AlertDialogTitle>
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
// Pending group card
// ---------------------------------------------------------------------------

function PendingGroupCard({
  group,
  elapsedLabel,
  error,
  notice,
  ridersByBib,
  onBibInputChange,
  onAddBib,
  onRemoveBib,
  onMoveBib,
  onSave,
  onDiscard,
}: {
  group: PendingGroup;
  elapsedLabel: string;
  error: string | null;
  notice: string | null;
  ridersByBib: Map<number, GroupFinishRider>;
  onBibInputChange: (id: string, value: string) => void;
  onAddBib: (group: PendingGroup) => void;
  onRemoveBib: (groupId: string, bib: number) => void;
  onMoveBib: (groupId: string, index: number, direction: -1 | 1) => void;
  onSave: (group: PendingGroup) => void;
  onDiscard: (groupId: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card px-4 py-3",
        error ? "border-destructive" : "border-border",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-2xl font-bold tabular-nums">
          {elapsedLabel}
        </span>
        <Input
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="Dorsal"
          aria-label="Número de dorsal"
          value={group.bibInput}
          onChange={(e) => onBibInputChange(group.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddBib(group);
            }
          }}
          className="h-12 flex-1 text-lg"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => onAddBib(group)}
          className="h-12 shrink-0 px-5 text-base"
        >
          Agregar
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}

      {/* Rider chips — order left→right = within-group finishing order */}
      {group.bibs.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Corredores del grupo">
          {group.bibs.map((entry, index) => {
            const rider = ridersByBib.get(entry.bib);
            return (
              <li
                key={entry.bib}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-1 text-sm font-medium",
                  entry.alreadyRecorded
                    ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100"
                    : "border-border bg-background",
                )}
                title={rider ? rider.rider_name : undefined}
              >
                <span
                  className="mr-0.5 inline-flex size-5 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                  aria-label={`Posición ${index + 1}`}
                >
                  {index + 1}
                </span>
                <span>
                  {entry.alreadyRecorded ? "⚠ " : ""}
                  {entry.alreadyRecorded ? `Dorsal ${entry.bib}` : `#${entry.bib}`}
                </span>
                <button
                  type="button"
                  onClick={() => onMoveBib(group.id, index, -1)}
                  disabled={index === 0}
                  aria-label={`Mover dorsal ${entry.bib} antes`}
                  className="ml-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => onMoveBib(group.id, index, 1)}
                  disabled={index === group.bibs.length - 1}
                  aria-label={`Mover dorsal ${entry.bib} después`}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveBib(group.id, entry.bib)}
                  aria-label={`Quitar dorsal ${entry.bib}`}
                  className="ml-0.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onDiscard(group.id)}
          className="h-11"
        >
          Descartar
        </Button>
        <Button
          type="button"
          onClick={() => onSave(group)}
          disabled={group.bibs.length === 0}
          className="h-11 px-6 text-base"
        >
          Guardar grupo
        </Button>
      </div>
    </div>
  );
}

"use client";

// Story 20 — Group stage start-line view.
//
// The operator selects which categories are starting together and presses
// "Iniciar". Each press is a "wave" — it records one `stage_category_starts`
// row per selected category (with that wave's `started_at`) and broadcasts a
// Realtime event so the finish-line view (Story 21) syncs immediately.
//
// Multiple waves are supported: after a wave the operator can select remaining
// categories and press Iniciar again; each wave has its own `started_at`.
//
// Shared infra used (per Stories 15/16):
//   - Each Iniciar press is enqueued via `writeQueue.enqueue(...)` with an
//     explicit `endpoint` override pointing to the group-start route handler.
//     This avoids colliding with the TT start endpoint that the global registry
//     maps `stage_category_starts:upsert` to (see Story 15 QueueEntry.endpoint).
//   - `useWriteQueueSync()` drives the 60s retry loop.
//   - `<ConnectivityIndicator />` is the first element (fixed top bar);
//     main content gets `pt-10` so it is not hidden behind it.
//   - Realtime broadcast via anon browser client (no privileged key used).

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConnectivityIndicator } from "@/components/connectivity-indicator";
import { writeQueue, useWriteQueueSync } from "@/lib/write-queue";
import { createClient } from "@/lib/supabase/client";
import {
  groupSessionChannel,
  GROUP_STARTED_EVENT,
  type GroupStartedPayload,
} from "@/lib/group-live";
import type { Category } from "@/types/app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats a UTC ISO string as a local HH:mm:ss es-CO clock label. */
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "HH:mm:ss", { locale: es });
}

/** Returns the group-start API endpoint path for a given race + stage. */
function groupStartEndpoint(slug: string, stageNumber: number): string {
  return `/api/races/${slug}/stages/${stageNumber}/live/group/start`;
}

const WAKELOCK_TIP_STORAGE_KEY = "group_wakelock_tip_dismissed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GroupStartLineCategory = Pick<Category, "id" | "name" | "sort_order">;

/** One completed wave, kept in the wave log. */
export type Wave = {
  categories: GroupStartLineCategory[];
  startedAt: string; // UTC ISO
};

type Props = {
  slug: string;
  stageNumber: number;
  stageId: string;
  stageName: string;
  stageDateLabel: string;
  categories: GroupStartLineCategory[];
  /** Categories already started (from existing DB rows on resume). */
  alreadyStartedCategoryIds: string[];
  /** Waves reconstructed from existing DB rows on resume (chronological). */
  initialWaves?: Wave[];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GroupStartLineView({
  slug,
  stageNumber,
  stageId,
  stageName,
  stageDateLabel,
  categories,
  alreadyStartedCategoryIds,
  initialWaves = [],
}: Props) {
  // Drive the write-queue 60s retry loop (Story 15 boundary).
  useWriteQueueSync();

  // Set of category ids that have been started in this session.
  const [startedIds, setStartedIds] = useState<Set<string>>(
    () => new Set(alreadyStartedCategoryIds),
  );

  // Currently selected (but not yet started) category ids.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Wave log (most recent last). Hydrated from server-provided history
  // (existing DB rows) so it survives a refresh; live waves append below.
  const [waves, setWaves] = useState<Wave[]>(() => initialWaves);

  // Wake lock tip visibility (once if unsupported/denied).
  const [showWakeTip, setShowWakeTip] = useState(false);

  // ---------------------------------------------------------------------------
  // Wake Lock — request on mount + re-request on visibility regain
  // ---------------------------------------------------------------------------
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      if (
        typeof window !== "undefined" &&
        window.localStorage.getItem(WAKELOCK_TIP_STORAGE_KEY) !== "1"
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
      if (
        typeof window !== "undefined" &&
        window.localStorage.getItem(WAKELOCK_TIP_STORAGE_KEY) !== "1"
      ) {
        setShowWakeTip(true);
      }
    }
  }, []);

  useEffect(() => {
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
      window.localStorage.setItem(WAKELOCK_TIP_STORAGE_KEY, "1");
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Category chip toggle
  // ---------------------------------------------------------------------------
  const handleToggle = useCallback(
    (categoryId: string) => {
      // Ignore taps on already-started categories (they are locked).
      if (startedIds.has(categoryId)) return;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(categoryId)) {
          next.delete(categoryId);
        } else {
          next.add(categoryId);
        }
        return next;
      });
    },
    [startedIds],
  );

  // ---------------------------------------------------------------------------
  // Iniciar wave
  // ---------------------------------------------------------------------------
  const handleStart = useCallback(() => {
    if (selectedIds.size === 0) return;

    const startedAt = new Date().toISOString();
    const categoryIdsForWave = [...selectedIds];
    const endpoint = groupStartEndpoint(slug, stageNumber);

    // Enqueue with explicit endpoint override — avoids collision with the TT
    // start endpoint registered globally for `stage_category_starts:upsert`.
    writeQueue.enqueue({
      table: "stage_category_starts",
      operation: "upsert",
      payload: {
        stage_id: stageId,
        category_ids: categoryIdsForWave,
      },
      endpoint,
    });

    // Broadcast via Realtime so Story 21 (finish line) syncs immediately.
    // Best-effort: the durable write is the queued one above.
    try {
      const supabase = createClient();
      const channel = supabase.channel(groupSessionChannel(stageId));
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          const broadcastPayload: GroupStartedPayload = {
            stage_id: stageId,
            category_ids: categoryIdsForWave,
            started_at: startedAt,
          };
          void channel.send({
            type: "broadcast",
            event: GROUP_STARTED_EVENT,
            payload: broadcastPayload,
          });
        }
      });
    } catch {
      // Broadcast failure is non-fatal.
    }

    // Record the wave and lock the started categories.
    const waveCategories = categories.filter((c) =>
      categoryIdsForWave.includes(c.id),
    );
    setWaves((prev) => [...prev, { categories: waveCategories, startedAt }]);
    setStartedIds((prev) => {
      const next = new Set(prev);
      for (const id of categoryIdsForWave) next.add(id);
      return next;
    });
    setSelectedIds(new Set());
  }, [selectedIds, stageId, slug, stageNumber, categories]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const allStarted =
    categories.length > 0 &&
    categories.every((c) => startedIds.has(c.id));

  const canStart = selectedIds.size > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <ConnectivityIndicator />
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-10">
        {/* Wake lock tip */}
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

        {/* Stage header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold">{stageName}</h1>
          <p className="capitalize text-muted-foreground">{stageDateLabel}</p>
        </div>

        {/* Category selector */}
        <section aria-labelledby="category-selector-heading">
          <div className="mb-3 flex flex-col gap-1">
            <h2
              id="category-selector-heading"
              className="text-base font-semibold"
            >
              Categorías
            </h2>
            {!allStarted && (
              <p className="text-sm text-muted-foreground">
                Selecciona todas las categorías que saldrán juntas y presiona
                Iniciar.
              </p>
            )}
          </div>

          {categories.length === 0 ? (
            <p className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
              Esta etapa no tiene categorías registradas.
            </p>
          ) : (
            <div
              className="flex flex-wrap gap-3"
              role="group"
              aria-label="Selección de categorías"
            >
              {categories
                .slice()
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((category) => {
                  const isStarted = startedIds.has(category.id);
                  const isSelected = selectedIds.has(category.id);

                  return (
                    <button
                      key={category.id}
                      type="button"
                      disabled={isStarted}
                      onClick={() => handleToggle(category.id)}
                      aria-pressed={isStarted ? undefined : isSelected}
                      aria-label={
                        isStarted
                          ? `${category.name} — Iniciada`
                          : category.name
                      }
                      className={cn(
                        // Base: large tappable chip
                        "relative inline-flex min-h-[3rem] min-w-[7rem] items-center justify-center rounded-xl border-2 px-5 py-3 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        // Started (locked): muted with checkmark
                        isStarted &&
                          "cursor-default border-green-500 bg-green-50 text-green-700 opacity-75 dark:border-green-700 dark:bg-green-950 dark:text-green-300",
                        // Selected (not yet started): highlighted
                        !isStarted &&
                          isSelected &&
                          "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                        // Idle (not started, not selected)
                        !isStarted &&
                          !isSelected &&
                          "border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {isStarted ? (
                        <>
                          <span className="mr-1.5" aria-hidden="true">
                            ✓
                          </span>
                          {category.name}
                          <span className="ml-1.5 text-xs font-normal opacity-80">
                            Iniciada
                          </span>
                        </>
                      ) : (
                        category.name
                      )}
                    </button>
                  );
                })}
            </div>
          )}
        </section>

        {/* Start button */}
        {!allStarted && categories.length > 0 && (
          <Button
            type="button"
            size="lg"
            className="h-24 w-full text-2xl font-bold"
            disabled={!canStart}
            onClick={handleStart}
          >
            Iniciar
          </Button>
        )}

        {/* All started state */}
        {allStarted && (
          <div className="rounded-xl border border-green-500 bg-green-50 px-6 py-5 text-center text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-200">
            <p className="text-lg font-semibold">
              Todas las categorías han iniciado
            </p>
          </div>
        )}

        {/* Wave log */}
        {waves.length > 0 && (
          <section aria-labelledby="wave-log-heading">
            <h2
              id="wave-log-heading"
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Historial de salidas
            </h2>
            <ol className="flex flex-col gap-2">
              {waves.map((wave, index) => (
                <li
                  key={index}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <span className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground">
                    Ola {index + 1}
                  </span>
                  <div className="flex flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm font-medium">
                    {wave.categories.map((c, ci) => (
                      <span key={c.id}>
                        {c.name}
                        {ci < wave.categories.length - 1 ? "," : ""}
                      </span>
                    ))}
                    <span className="ml-1 font-normal text-muted-foreground">
                      — iniciada a las {formatLocalTime(wave.startedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </>
  );
}

"use client";

// Story 16 — Connectivity status indicator.
//
// Rendered as a fixed bar at the top of the screen on all live-tracking views
// (Stories 17–22). It reads reactive queue state from the Story 15 write queue
// via `useSyncExternalStore` and renders one of four visual states:
//
//   1. Connected + empty queue  → subtle green dot + "Conectado"
//   2. Offline / pending writes → full-width amber/red warning banner
//   3. Reconnecting (flushing)  → spinner + "Enviando X actualizaciones…"
//   4. Just-synced confirmation → brief green "Todas las actualizaciones se enviaron ✓"
//
// Usage in live-tracking views (17–22):
//   - Import: `import { ConnectivityIndicator } from "@/components/connectivity-indicator"`
//   - Place at the very top of the page's JSX, BEFORE the main content wrapper.
//   - The bar is `position: fixed; top: 0; left: 0; right: 0` so it sits above
//     everything else. Add `pt-[indicator-height]` (e.g. `pt-10`) to the main
//     content wrapper so content is not hidden behind the bar. On mobile this
//     ensures STOP buttons lower on the page are never obscured.
//   - The live views themselves must call `useWriteQueueSync()` from
//     `@/lib/write-queue` to own the 60-second retry loop; this component does
//     NOT call it, following the responsibility boundary stated in Story 15.
//
// Countdown assumption: the 60-second retry loop is driven by the live view via
// `useWriteQueueSync()`. The countdown shown in the warning banner is derived
// locally: it ticks from `lastSyncAt` (or component mount if `lastSyncAt` is
// null) toward the next 60-second boundary, using a 1-second `setInterval`.
// It is an estimate — the actual interval resets each time `flush()` runs —
// which is acceptable for operator UX.

import { useCallback, useEffect, useRef, useSyncExternalStore, useState } from "react";
import {
  WifiOffIcon,
  WifiIcon,
  RefreshCwIcon,
  CheckCircle2Icon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { writeQueue, type QueueState } from "@/lib/write-queue";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// ---------------------------------------------------------------------------
// SSR-safe server snapshot — never touches `window`
// ---------------------------------------------------------------------------

const SERVER_SNAPSHOT: QueueState = {
  pendingCount: 0,
  isSyncing: false,
  isOnline: true,
  lastSyncAt: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns "actualización" (singular) or "actualizaciones" (plural). */
function pluralUpdate(count: number): string {
  return count === 1 ? "actualización" : "actualizaciones";
}

const RETRY_INTERVAL_MS = 60_000;

/** Compute seconds remaining until the next automatic retry. */
function secondsUntilRetry(lastSyncAt: string | null, mountedAt: number): number {
  const baseline = lastSyncAt ? new Date(lastSyncAt).getTime() : mountedAt;
  const elapsed = Date.now() - baseline;
  const remaining = Math.max(0, RETRY_INTERVAL_MS - elapsed);
  return Math.ceil(remaining / 1_000);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConnectivityIndicator() {
  const state = useSyncExternalStore(
    writeQueue.subscribe,
    writeQueue.getState,
    () => SERVER_SNAPSHOT,
  );

  const { pendingCount, isSyncing, isOnline, lastSyncAt } = state;

  // Track mount time so the countdown works even before the first sync.
  // Initialised to 0 here (SSR-safe); set to Date.now() on mount via useEffect.
  const mountedAtRef = useRef(0);

  // Countdown seconds shown in the warning banner. Starts at 60 (the retry
  // interval length); the mount effect below syncs it to the real value.
  const [countdown, setCountdown] = useState<number>(60);

  // Record the actual mount time in an effect (safe: effects run only in the browser).
  useEffect(() => {
    mountedAtRef.current = Date.now();
    setCountdown(secondsUntilRetry(lastSyncAt, mountedAtRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // Detect transition from pendingCount > 0 → 0 to show the confirmation state.
  const prevPendingRef = useRef(pendingCount);
  const [justSynced, setJustSynced] = useState(false);
  const justSyncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevPendingRef.current;
    prevPendingRef.current = pendingCount;
    if (prev > 0 && pendingCount === 0 && !isSyncing) {
      setJustSynced(true);
      if (justSyncedTimerRef.current) {
        clearTimeout(justSyncedTimerRef.current);
      }
      justSyncedTimerRef.current = setTimeout(() => {
        setJustSynced(false);
      }, 3_000);
    }
    return () => {
      // Cleanup runs on every render — only clear on unmount via the outer effect.
    };
  }, [pendingCount, isSyncing]);

  // Clear the justSynced timer on unmount.
  useEffect(() => {
    return () => {
      if (justSyncedTimerRef.current) {
        clearTimeout(justSyncedTimerRef.current);
      }
    };
  }, []);

  // Tick the countdown every second, but only while there are pending entries.
  useEffect(() => {
    if (pendingCount === 0 || isSyncing) return;
    const tick = () => {
      setCountdown(secondsUntilRetry(lastSyncAt, mountedAtRef.current));
    };
    tick(); // sync immediately
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [pendingCount, isSyncing, lastSyncAt]);

  const handleRetry = useCallback(() => {
    // Reset the local countdown baseline so it starts counting from now.
    mountedAtRef.current = Date.now();
    void writeQueue.flush();
  }, []);

  // ---------------------------------------------------------------------------
  // State: Reconnecting (flush in progress)
  // ---------------------------------------------------------------------------
  if (isSyncing && pendingCount > 0) {
    return (
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2",
          "bg-amber-500 px-4 py-2 text-sm font-medium text-white",
        )}
        role="status"
        aria-live="polite"
      >
        <Spinner className="size-4 text-white" />
        <span>
          Enviando {pendingCount} {pluralUpdate(pendingCount)}&hellip;
        </span>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // State: Offline / pending writes
  // ---------------------------------------------------------------------------
  if (pendingCount > 0 || !isOnline) {
    const offlineLabel = !isOnline
      ? "Sin conexión"
      : "Error al sincronizar";

    return (
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-1",
          "bg-red-600 px-4 py-2 text-sm font-medium text-white",
        )}
        role="alert"
        aria-atomic="true"
      >
        {/* Left: icon + message */}
        <div className="flex items-center gap-2">
          <WifiOffIcon className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {offlineLabel} &mdash;{" "}
            {pendingCount > 0
              ? `${pendingCount} ${pluralUpdate(pendingCount)} pendiente${pendingCount !== 1 ? "s" : ""} de enviar`
              : "Esperando conexión"}
          </span>
        </div>

        {/* Right: countdown + retry button */}
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="text-white/80 text-xs">
              Reintentando en {countdown} s
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white disabled:opacity-50"
            onClick={handleRetry}
            disabled={isSyncing}
            aria-label="Reintentar sincronización ahora"
          >
            <RefreshCwIcon className="size-3.5 mr-1" aria-hidden="true" />
            Reintentar ahora
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // State: All synced — brief confirmation
  // ---------------------------------------------------------------------------
  if (justSynced) {
    return (
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2",
          "bg-green-600 px-4 py-2 text-sm font-medium text-white",
        )}
        role="status"
        aria-live="polite"
      >
        <CheckCircle2Icon className="size-4" aria-hidden="true" />
        <span>Todas las actualizaciones se enviaron ✓</span>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // State: Connected + empty queue (normal / unobtrusive)
  // ---------------------------------------------------------------------------
  return (
    <div
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex items-center justify-end gap-1.5",
        "bg-transparent px-3 py-1.5",
      )}
      role="status"
      aria-live="polite"
    >
      <WifiIcon className="size-3.5 text-green-500" aria-hidden="true" />
      <span className="text-xs font-medium text-green-600 dark:text-green-400">
        Conectado
      </span>
    </div>
  );
}

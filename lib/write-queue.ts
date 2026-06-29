"use client";

// Story 15 — Write queue & offline sync engine.
//
// Shared client-side infrastructure used by every live-tracking view
// (Stories 17–22). All database writes made during live tracking are queued
// in localStorage first, then flushed to the server by POSTing to Next.js
// route handlers (NEVER directly to Supabase — there is no RLS, so privileged
// writes happen server-side behind authenticated route handlers).
//
// This module is browser-only but is import-safe under SSR: every `window`,
// `localStorage`, `navigator`, and event-listener access is guarded so that
// importing it from a "use client" component rendered on the server does not
// throw.

import { useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Target Supabase table for a queued mutation (matches the Story 01 schema). */
export type QueueTable =
  | "results"
  | "tt_start_order"
  | "stage_category_starts"
  | "registrations"
  | "riders";

export type QueueOperation = "insert" | "update" | "upsert";

export type QueueEntryStatus = "pending" | "syncing" | "synced" | "error";

/**
 * A single queued write. The `table`/`operation`/`payload` triple describes the
 * intended mutation; `flush` maps it to the matching route handler (see
 * `ENDPOINT_REGISTRY` / the optional `endpoint` override) and POSTs the payload.
 */
export type QueueEntry = {
  /** Client-generated uuid (`crypto.randomUUID()`). */
  id: string;
  /** Target Supabase table. */
  table: QueueTable;
  operation: QueueOperation;
  /** Row data to write. `captured_at` is merged into the POST body on flush. */
  payload: Record<string, unknown>;
  /** ISO timestamp — client-side capture time, used for server-side ordering. */
  captured_at: string;
  status: QueueEntryStatus;
  attempts: number;
  last_attempt_at: string | null;
  error_message: string | null;
  /**
   * Optional explicit route-handler path. When omitted, the endpoint is
   * resolved from `ENDPOINT_REGISTRY` by `table`+`operation`. Supplying it lets
   * a live view target a specific endpoint without touching the registry.
   */
  endpoint?: string;
};

/** Reactive state consumed by the Story 16 connectivity indicator. */
export type QueueState = {
  /** pending + error entries. */
  pendingCount: number;
  /** A flush is currently in progress. */
  isSyncing: boolean;
  /** `navigator.onLine`. */
  isOnline: boolean;
  /** ISO timestamp of the last successful flush, or `null`. */
  lastSyncAt: string | null;
};

/** Shape accepted by `enqueue` — the queue assigns id/timestamps/status. */
export type EnqueueInput = {
  table: QueueTable;
  operation: QueueOperation;
  payload: Record<string, unknown>;
  endpoint?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "race_write_queue";
const RETRY_INTERVAL_MS = 60_000;

// Fast-retry backoff for entries left in `error` after a flush. Live group saves
// enqueue several writes that flush concurrently and POST to the same endpoint;
// the server's per-rider upsert + per-category re-rank can transiently conflict
// (e.g. Postgres serialization/deadlock surfaced as a 500), marking one entry
// `error`. Without this, that entry would only be retried by the 60s
// `useWriteQueueSync` interval, leaving a rider unsynced for up to a minute. We
// instead schedule a few quick, exponentially-spaced retries so a transient
// failure recovers in a couple of seconds. Capped attempts/delay keep us from
// hammering the server on a genuine, persistent failure (the 60s loop still
// covers that long tail).
const FAST_RETRY_BASE_MS = 750;
const FAST_RETRY_MAX_DELAY_MS = 6_000;
const FAST_RETRY_MAX_ATTEMPTS = 5;

/** Spanish (es-CO) native beforeunload warning shown with unsynced entries. */
const BEFOREUNLOAD_MESSAGE =
  "Tienes cambios sin guardar. ¿Seguro que quieres salir?";

/**
 * Maps `table:operation` → Next.js route-handler path. Stories 17–22 build the
 * endpoints themselves; they only need to register their `table`+`operation`
 * here (or pass an explicit `endpoint` when enqueuing). Each handler must accept
 * a POST whose JSON body is the entry's `payload` plus `captured_at`.
 */
const ENDPOINT_REGISTRY: Partial<Record<string, string>> = {
  // Example mappings (endpoints are implemented in later stories):
  // "results:insert": "/api/live/results",
  // "results:upsert": "/api/live/results",
  // "tt_start_order:upsert": "/api/live/tt-start-order",
  // "stage_category_starts:upsert": "/api/live/stage-starts",
};

function registryKey(table: QueueTable, operation: QueueOperation): string {
  return `${table}:${operation}`;
}

/**
 * Register (or override) a route-handler path for a `table`+`operation` pair.
 * Stories 17–22 call this once at module load instead of editing this file.
 */
export function registerEndpoint(
  table: QueueTable,
  operation: QueueOperation,
  endpoint: string,
): void {
  ENDPOINT_REGISTRY[registryKey(table, operation)] = endpoint;
}

function resolveEndpoint(entry: QueueEntry): string | undefined {
  return entry.endpoint ?? ENDPOINT_REGISTRY[registryKey(entry.table, entry.operation)];
}

// ---------------------------------------------------------------------------
// Environment guards
// ---------------------------------------------------------------------------

const isBrowser = (): boolean => typeof window !== "undefined";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let queue: QueueEntry[] = [];
let isSyncing = false;
let lastSyncAt: string | null = null;
let flushInFlight: Promise<void> | null = null;
// Pending fast-retry timer id (browser `setTimeout`). At most one is armed at a
// time; it is cleared/re-armed after every flush based on the remaining errors.
let fastRetryTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<(state: QueueState) => void>();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadFromStorage(): QueueEntry[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Normalise any entry left mid-flight (`syncing`) back to `pending`.
    return (parsed as QueueEntry[]).map((entry) =>
      entry.status === "syncing" ? { ...entry, status: "pending" } : entry,
    );
  } catch {
    return [];
  }
}

function persist(): void {
  if (!isBrowser()) return;
  try {
    // Only durable entries are persisted; `synced` ones are dropped.
    const durable = queue.filter((entry) => entry.status !== "synced");
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
  } catch {
    // Storage full / unavailable — nothing else we can safely do here.
  }
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

function isOnline(): boolean {
  if (!isBrowser()) return true;
  return navigator.onLine;
}

// Cached snapshot so `getState` returns a referentially-stable value when
// nothing has changed. This is required by `useSyncExternalStore`, whose
// `getSnapshot` must not return a fresh object on every call (otherwise React
// detects a new snapshot each render and loops infinitely).
let cachedState: QueueState = {
  pendingCount: 0,
  isSyncing: false,
  isOnline: true,
  lastSyncAt: null,
};

function getState(): QueueState {
  const pendingCount = queue.filter(
    (entry) => entry.status === "pending" || entry.status === "error",
  ).length;
  const online = isOnline();

  // Only allocate a new object (and break referential equality) when a value
  // actually changed; otherwise return the previous snapshot.
  if (
    cachedState.pendingCount !== pendingCount ||
    cachedState.isSyncing !== isSyncing ||
    cachedState.isOnline !== online ||
    cachedState.lastSyncAt !== lastSyncAt
  ) {
    cachedState = {
      pendingCount,
      isSyncing,
      isOnline: online,
      lastSyncAt,
    };
  }

  return cachedState;
}

function notify(): void {
  const state = getState();
  for (const listener of listeners) {
    listener(state);
  }
  syncBeforeUnloadGuard();
}

/**
 * Subscribe to queue-state changes. Returns an unsubscribe function. The
 * listener is invoked immediately with the current state. Designed for Story
 * 16's `useSyncExternalStore`-style consumption.
 */
export function subscribe(listener: (state: QueueState) => void): () => void {
  listeners.add(listener);
  listener(getState());
  return () => {
    listeners.delete(listener);
  };
}

/** Read the current queue state synchronously. */
export function getQueueState(): QueueState {
  return getState();
}

// ---------------------------------------------------------------------------
// beforeunload guard
// ---------------------------------------------------------------------------

let beforeUnloadAttached = false;

function handleBeforeUnload(event: BeforeUnloadEvent): string {
  event.preventDefault();
  // Legacy browsers read `returnValue`; modern ones show their own message.
  event.returnValue = BEFOREUNLOAD_MESSAGE;
  return BEFOREUNLOAD_MESSAGE;
}

function syncBeforeUnloadGuard(): void {
  if (!isBrowser()) return;
  const hasUnsynced = queue.some(
    (entry) => entry.status === "pending" || entry.status === "error",
  );
  if (hasUnsynced && !beforeUnloadAttached) {
    window.addEventListener("beforeunload", handleBeforeUnload);
    beforeUnloadAttached = true;
  } else if (!hasUnsynced && beforeUnloadAttached) {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    beforeUnloadAttached = false;
  }
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Append a write to the queue: assigns a client uuid + `captured_at`, persists
 * to localStorage immediately, then fires a non-blocking flush. Returns the
 * created entry.
 */
function enqueue(input: EnqueueInput): QueueEntry {
  const entry: QueueEntry = {
    id: isBrowser() && "randomUUID" in crypto ? crypto.randomUUID() : fallbackUuid(),
    table: input.table,
    operation: input.operation,
    payload: input.payload,
    captured_at: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    last_attempt_at: null,
    error_message: null,
    endpoint: input.endpoint,
  };

  queue.push(entry);
  persist();
  notify();

  // Fire-and-forget — never blocks the caller (the live-tracking UI).
  void flush();

  return entry;
}

function fallbackUuid(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

/**
 * Flush all `pending`/`error` entries in `captured_at` order. Entries are sent
 * concurrently (non-blocking). On success an entry is marked `synced` and
 * removed from localStorage; on failure it is marked `error` with an
 * incremented attempt count. Concurrent flush calls share one in-flight run.
 */
function flush(): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = runFlush().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function runFlush(): Promise<void> {
  if (!isBrowser()) return;

  const pending = queue
    .filter((entry) => entry.status === "pending" || entry.status === "error")
    .sort((a, b) => a.captured_at.localeCompare(b.captured_at));

  if (pending.length === 0) return;

  // Skip network work while offline — entries stay queued and retry later.
  if (!isOnline()) return;

  isSyncing = true;
  // Optimistically mark entries `syncing` so re-entrant flushes skip them.
  for (const entry of pending) {
    entry.status = "syncing";
  }
  notify();

  let anySynced = false;

  await Promise.all(
    pending.map(async (entry) => {
      const ok = await sendEntry(entry);
      if (ok) anySynced = true;
    }),
  );

  // Drop synced entries from the in-memory queue.
  queue = queue.filter((entry) => entry.status !== "synced");

  isSyncing = false;
  if (anySynced) {
    lastSyncAt = new Date().toISOString();
  }

  persist();
  notify();

  // If any entry is still in `error`, schedule a quick retry instead of waiting
  // for the slow 60s loop — this is what makes a transient conflict on one of
  // several concurrent group writes recover in seconds.
  scheduleFastRetry();
}

/**
 * Arm a single short, exponentially-backed-off retry for entries still in
 * `error`. Re-armed after each flush; backoff grows with the lowest remaining
 * attempt count so repeated failures space out. Stops fast-retrying once an
 * entry has exhausted `FAST_RETRY_MAX_ATTEMPTS` — the 60s `useWriteQueueSync`
 * loop remains the safety net for genuinely persistent failures, so we never
 * busy-loop against the server.
 */
function scheduleFastRetry(): void {
  if (!isBrowser()) return;

  // Clear any previously-armed retry so we don't stack timers.
  if (fastRetryTimer !== null) {
    clearTimeout(fastRetryTimer);
    fastRetryTimer = null;
  }

  // Only consider entries that have failed but are still within the fast-retry
  // budget; beyond that the slow loop takes over.
  const retryable = queue.filter(
    (entry) =>
      entry.status === "error" && entry.attempts < FAST_RETRY_MAX_ATTEMPTS,
  );
  if (retryable.length === 0) return;

  // Back off based on the fewest attempts among retryable entries so a freshly
  // failed entry retries soon while older repeat-failures wait longer.
  const minAttempts = retryable.reduce(
    (min, entry) => Math.min(min, entry.attempts),
    Number.POSITIVE_INFINITY,
  );
  const delay = Math.min(
    FAST_RETRY_BASE_MS * 2 ** Math.max(0, minAttempts - 1),
    FAST_RETRY_MAX_DELAY_MS,
  );

  fastRetryTimer = setTimeout(() => {
    fastRetryTimer = null;
    void flush();
  }, delay);
}

async function sendEntry(entry: QueueEntry): Promise<boolean> {
  const endpoint = resolveEndpoint(entry);
  entry.last_attempt_at = new Date().toISOString();

  if (!endpoint) {
    entry.status = "error";
    entry.attempts += 1;
    entry.error_message = `No endpoint registered for ${entry.table}:${entry.operation}`;
    return false;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `captured_at` travels with the payload for server-side conflict
      // resolution (especially upserts).
      body: JSON.stringify({ ...entry.payload, captured_at: entry.captured_at }),
    });

    if (!response.ok) {
      entry.status = "error";
      entry.attempts += 1;
      entry.error_message = `HTTP ${response.status}`;
      return false;
    }

    entry.status = "synced";
    entry.error_message = null;
    return true;
  } catch (error) {
    entry.status = "error";
    entry.attempts += 1;
    entry.error_message =
      error instanceof Error ? error.message : "Error de red desconocido";
    return false;
  }
}

// ---------------------------------------------------------------------------
// Initialisation (browser only)
// ---------------------------------------------------------------------------

let initialised = false;

function init(): void {
  if (initialised || !isBrowser()) return;
  initialised = true;

  queue = loadFromStorage();

  window.addEventListener("online", handleOnlineChange);
  window.addEventListener("offline", handleOnlineChange);

  syncBeforeUnloadGuard();

  // Retry any persisted pending entries on app load.
  void flush();
}

function handleOnlineChange(): void {
  notify();
  if (isOnline()) {
    void flush();
  }
}

// Self-initialise on first import in the browser.
if (isBrowser()) {
  init();
}

// ---------------------------------------------------------------------------
// Public queue API
// ---------------------------------------------------------------------------

/**
 * The write queue. Live-tracking views enqueue every write through this object;
 * Story 16 reads/subscribes to its state and triggers manual flushes.
 */
export const writeQueue = {
  enqueue,
  /** Trigger a flush manually (e.g. Story 16's "retry" button). */
  flush,
  subscribe,
  getState: getQueueState,
  registerEndpoint,
};

// ---------------------------------------------------------------------------
// React hook — retry loop
// ---------------------------------------------------------------------------

/**
 * Mount this in any live-tracking view to drive the 60s retry loop. It flushes
 * once on mount and every `RETRY_INTERVAL_MS` thereafter, clearing the interval
 * on unmount. SSR-safe: the interval only runs in the browser.
 */
export function useWriteQueueSync(): void {
  useEffect(() => {
    if (!isBrowser()) return;
    void writeQueue.flush();
    const interval = window.setInterval(() => {
      void writeQueue.flush();
    }, RETRY_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, []);
}

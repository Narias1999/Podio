# Story 15 — Write queue & offline sync engine

## Overview
All database writes made during live tracking are queued in local storage first, then synced to the server. If the connection drops, writes are retried automatically every 60 seconds. This is shared infrastructure used by all live tracking views (Stories 17–22).

## User story
As a finish line operator with poor connectivity, I need the app to save my timing data locally so that nothing is lost if the connection drops for a few minutes.

## Architecture

### Write queue
A client-side queue module (`/lib/write-queue.ts`) wraps all server writes made during live tracking sessions. It must be used by every live tracking write — STOP captures, bib assignments, group saves, start timestamps.

Because there is no RLS (Story 01), writes are **not** sent directly to Supabase from the client. Each queue entry is flushed by POSTing to the relevant Next.js route handler, which authorizes the organizer and performs the privileged write server-side. The `table`/`operation`/`payload` shape below describes the intended mutation; the flush maps it to the matching endpoint.

**Queue entry shape:**
```ts
type QueueEntry = {
  id: string            // client-generated uuid
  table: string         // target Supabase table
  operation: 'insert' | 'update' | 'upsert'
  payload: object       // the row data to write
  captured_at: string   // ISO timestamp — client-side capture time, used for server ordering
  status: 'pending' | 'syncing' | 'synced' | 'error'
  attempts: number
  last_attempt_at: string | null
  error_message: string | null
}
```

### Local storage persistence
- The queue is stored in `localStorage` under the key `race_write_queue`
- On every enqueue, the queue is serialised and written to local storage immediately
- On app load, the queue is read from local storage and any pending entries are retried

### Enqueue
```ts
writeQueue.enqueue(entry)
```
- Assigns a client uuid and `captured_at` timestamp
- Appends to in-memory queue and persists to local storage
- Immediately attempts to flush (fire-and-forget, non-blocking)

### Flush
```ts
writeQueue.flush()
```
- Iterates all entries with `status = 'pending'` or `status = 'error'`
- POSTs each to its Next.js route handler in captured_at order
- On success: marks entry `synced` and removes it from local storage
- On failure: marks entry `error`, increments `attempts`, sets `last_attempt_at`
- Flush is non-blocking — multiple entries are sent concurrently

### Retry loop
- A retry interval is set up on mount of any live tracking view: `setInterval(flush, 60_000)`
- The interval is cleared on unmount
- A manual retry can also be triggered from the connectivity status indicator (Story 16)

### Conflict resolution
- The `captured_at` field is included in every write payload so the server can use it as the authoritative timestamp regardless of when the write arrives
- For `upsert` operations, the server uses `captured_at` to determine which write wins on conflict

### Browser navigation guard
- When the queue has any `pending` or `error` entries, attach a `beforeunload` event listener that shows the browser's native warning: "You have unsaved changes. Are you sure you want to leave?"
- Remove the listener when the queue is empty

## Exposed state (for Story 16 connectivity indicator)
The queue module exposes a reactive state object:
```ts
type QueueState = {
  pendingCount: number      // pending + error entries
  isSyncing: boolean        // flush is currently in progress
  isOnline: boolean         // navigator.onLine
  lastSyncAt: string | null // ISO timestamp of last successful flush
}
```

## Acceptance criteria
- [ ] Every live tracking write goes through the queue module — no direct Supabase calls in live tracking views; flush POSTs to Next.js route handlers (no client-side privileged writes)
- [ ] Queue entries are persisted to local storage before any network attempt
- [ ] On app reload, pending entries are loaded from local storage and retried
- [ ] Flush sends entries in `captured_at` order
- [ ] Retry runs automatically every 60 seconds while a live view is mounted
- [ ] Successful syncs are removed from the queue and from local storage
- [ ] `beforeunload` warning is shown when pending entries exist
- [ ] `beforeunload` listener is removed when queue is empty
- [ ] Queue state (pendingCount, isSyncing, isOnline) is accessible to the UI layer

## Dependencies
- Story 01 (schema — queue entries reference table names from the schema)
- Story 02 (auth — Supabase client must be authenticated before flush can write)

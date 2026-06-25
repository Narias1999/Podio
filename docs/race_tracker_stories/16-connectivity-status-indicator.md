# Story 16 — Connectivity status indicator

## Overview
A persistent UI component shown on all live tracking views that communicates the current connection state and pending write count to the operator. Built on top of the queue state from Story 15.

## User story
As a finish line or start line operator, I need to always know if my device has connectivity issues and whether there is data waiting to be sent, so that I don't close the app and lose timing data.

## Component

### Location
- Rendered as a fixed bar at the top of the screen on all live tracking views:
  - TT start line (`/races/[slug]/stages/[stage]/live/tt/start`)
  - TT finish line (`/races/[slug]/stages/[stage]/live/tt/finish`)
  - Group stage start line (`/races/[slug]/stages/[stage]/live/group/start`)
  - Group stage finish line (`/races/[slug]/stages/[stage]/live/group/finish`)
- Always visible — not collapsible or dismissible while pending writes exist

### States

**Connected — queue empty** (normal state)
- Subtle green indicator dot + "Connected" label
- Small and unobtrusive — should not distract during normal operation

**Offline or syncing — pending writes exist** (warning state)
- Full-width banner, high-contrast warning colour (amber or red)
- Icon + message: "No connection — X updates waiting to send"
- A **Retry now** button triggers an immediate flush attempt
- Counts down to next automatic retry: "Retrying in 45s"

**Reconnecting** (transitional state)
- Spinner + "Sending X updates…" message
- Shown while a flush is in progress

**All synced after reconnection** (confirmation state)
- Brief green confirmation: "All updates sent ✓"
- Fades back to the normal connected state after 3 seconds

### Behaviour rules
- The component reads `pendingCount`, `isSyncing`, `isOnline`, and `lastSyncAt` from the write queue state (Story 15)
- When `pendingCount > 0`, the browser `beforeunload` warning is active (managed by the queue module — this component does not need to add it separately)
- The **Retry now** button is disabled while `isSyncing = true`
- On mobile, the warning banner must not obscure the STOP button — it sits above the main content area

### Accessibility
- Warning state uses both colour and text — never colour alone
- The warning banner is announced to screen readers via `role="alert"` so assistive technology users are notified of connectivity problems

## Acceptance criteria
- [ ] Connected + empty queue state is subtle and unobtrusive
- [ ] Warning state shows pending count, retry button, and countdown
- [ ] Retry now button triggers an immediate flush
- [ ] Reconnecting state shows while flush is in progress
- [ ] Confirmation state shows briefly after all entries sync
- [ ] Warning banner does not obscure the STOP button on mobile
- [ ] Warning state uses both colour and text (not colour alone)
- [ ] `role="alert"` is set on the warning banner

## Dependencies
- Story 15 (write queue must expose reactive state)

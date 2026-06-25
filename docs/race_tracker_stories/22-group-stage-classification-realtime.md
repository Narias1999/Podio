# Story 22 — Group stage classification & real-time results

## Overview
When a group is saved at the finish line, all riders in the group are classified automatically — each receives the same finish time, within-group order is used as a tiebreaker for position assignment, and results are published to the public page in real time.

## User story
As a race organizer, I need group stage results to be classified and published automatically as groups are saved so that standings are visible to the public in real time without any manual step.

## Classification logic

### Finish time
All riders in a group receive the same `elapsed_seconds` — the elapsed time captured at STOP tap.

### Net time calculation
```
net_seconds = elapsed_seconds − category_start_offset_seconds
category_start_offset_seconds = (category started_at − earliest started_at in this stage) in seconds
```

For the first wave (earliest `started_at`), `category_start_offset_seconds = 0`.
For subsequent waves, it is the number of seconds after the first wave that category started.

This ensures riders who started in a later wave are not penalised by their later start time.

### Position assignment
- After each group save, re-rank all saved `finished` results within each category by `net_seconds` ascending
- Within riders sharing the same `net_seconds` (i.e. members of the same group), rank by `group_position` ascending
- Assign sequential `position` values starting from 1 across the category
- Positions update each time a new group is saved — early estimates may shift as more groups are recorded

### Database write (via write queue)
The writes are performed server-side: the queue (Story 15) POSTs to a Next.js route handler that authorizes the organizer and runs the upserts (no RLS, no direct client write). For each rider in a saved group, enqueue an upsert to `results`:
```ts
{
  stage_id,
  registration_id,       // looked up from bib number
  elapsed_seconds,       // shared group elapsed time
  net_seconds,           // calculated per rider's category start offset
  position,              // assigned rank within category
  group_position,        // within-group order (tiebreaker)
  status: 'finished',
  captured_at,           // client-side STOP tap timestamp
}
```

All riders in the same group share the same `captured_at` (the STOP tap time).
Use `upsert` on `(stage_id, registration_id)` — idempotent on retry.

### Real-time push
- After each successful write, Supabase Realtime broadcasts the change to the public results channel for this stage
- The public results page updates in real time without a page refresh
- GC standings are recalculated and also broadcast

## Edge cases
- If the write queue retries and a group is written twice, the upsert is idempotent — duplicate writes do not create duplicate rows or incorrect positions
- If two groups arrive almost simultaneously (two STOP taps close together) and their writes arrive out of order, `captured_at` determines which group has the earlier finish time — server does not use write arrival order
- If a rider's category did not have a `started_at` recorded (operator forgot to start that wave), the result is saved without a `net_seconds` and flagged with a warning on the organizer results screen: "No start time recorded for this category — net time cannot be calculated."

## Acceptance criteria
- [ ] All riders in a group receive the same `elapsed_seconds`
- [ ] Net time correctly subtracts each rider's category start offset
- [ ] Positions within a category are re-ranked after each group save
- [ ] `group_position` is used as a tiebreaker within same-time groups
- [ ] Upsert is idempotent — retrying does not duplicate or corrupt results
- [ ] Saved results appear on the public results page via Realtime immediately
- [ ] GC standings update after each group is saved
- [ ] Missing category start time is flagged on the results screen with a clear warning
- [ ] `captured_at` is the authoritative timestamp, not server arrival time

## Dependencies
- Story 14 (public results page subscribed to Realtime)
- Story 15 (write queue)
- Story 20 (start line must have recorded `started_at` per category)
- Story 21 (group finish line produces the inputs to this logic)

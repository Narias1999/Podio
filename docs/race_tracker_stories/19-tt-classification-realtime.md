# Story 19 — TT classification & real-time results

## Overview
When a TT finish entry is saved, the system classifies the rider automatically — calculating net time, assigning a position within their category, and publishing the result to the public results page in real time.

## User story
As a race organizer, I need TT results to be classified and published automatically as riders finish so that spectators see live standings without any manual publishing step.

## Classification logic

### Net time calculation
```
net_seconds = (finish elapsed_at − session start timestamp) − rider's scheduled start offset
rider's scheduled start offset = (rider's start position − 1) × interval_seconds
```

Both timestamps are in UTC milliseconds; convert to seconds for storage.

### Position assignment
- After saving a result, re-rank all saved results within the same category by `net_seconds` ascending
- Assign `position = 1` to the fastest, incrementing for each subsequent rider
- Positions update each time a new result is saved — a rider's position may change as more results come in
- DNF/DSQ results are not assigned a position; they appear below finishers

### Database write (via write queue)
The write is performed server-side: the queue (Story 15) POSTs to a Next.js route handler that authorizes the organizer and runs the upsert (no RLS, no direct client write). On each confirmed bib entry at the finish line, enqueue an upsert to `results`:
```ts
{
  stage_id,
  registration_id,        // looked up from bib number
  finish_time,            // absolute UTC timestamp
  elapsed_seconds,        // elapsed at STOP tap in seconds
  net_seconds,            // calculated as above
  position,               // assigned rank within category
  status: 'finished',
  captured_at,            // client-side STOP tap timestamp
}
```

Use `upsert` with `on_conflict: (stage_id, registration_id)` to handle retries safely — writing the same result twice is idempotent.

### Real-time push to public results page
- After a successful write, Supabase Realtime broadcasts the change to all subscribers on the public results channel for this stage
- The public results page (Story 14) subscribes to this channel and updates the standings table in real time without a page refresh
- No separate publishing step — saved = visible

### GC update
- After each TT result is saved, GC standings are recalculated for the race (Story 10 logic)
- GC update also broadcasts via Realtime to the public results page

## Edge cases
- If the write queue delivers a result out of order (network retry arrives after a later result), the `captured_at` field is used to determine the correct elapsed time — server does not recalculate from arrival time
- If a bib is reassigned (operator overwrites a result), the upsert replaces the previous row and positions are recalculated

## Acceptance criteria
- [ ] Net time is correctly calculated as elapsed − scheduled start offset
- [ ] Positions within a category update correctly after each new result
- [ ] Upsert is idempotent — saving the same result twice does not create duplicates
- [ ] Saved result is immediately visible on the public results page via Realtime
- [ ] GC standings update after each TT result is saved
- [ ] `captured_at` is stored and used as the authoritative time, not server arrival time

## Dependencies
- Story 14 (public results page must be subscribed to Realtime)
- Story 15 (write queue handles delivery)
- Story 18 (TT finish line produces the inputs to this logic)

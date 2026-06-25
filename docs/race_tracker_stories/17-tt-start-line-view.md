# Story 17 — TT start line view

## Overview
The start line view for a time trial stage. A single operator opens this on a device at the start gate, presses Start when the first rider departs, and then leaves the screen running — no further interaction is needed.

## User story
As the start line operator, I need a screen that counts down to each rider's departure and shows me who is coming next so that I can call riders to the start gate without needing to track anything manually.

## Route
`/races/[slug]/stages/[stage]/live/tt/start`

Requires authentication (organizer login).

## Pre-start state

Before the session is started:
- Shows the stage name and date
- Shows the configured first rider start time, interval, and gap between categories
- A large **Start TT** button — the only action on this screen before the session begins
- Pressing **Start TT**:
  - Records the current UTC timestamp as the session anchor in `stage_category_starts` (one row per category, all with the same timestamp)
  - Broadcasts the start event via Supabase Realtime so the finish line view syncs immediately
  - Transitions the view to the live countdown state

## Live countdown state

### Primary display (top half of screen)
- **Countdown timer** — large, full-width, counts down to the next rider's departure (format: `0:45` or `1:23`)
- When the countdown hits zero, it briefly flashes and immediately resets to the next rider's interval
- **Current rider** — prominently below the timer: bib number, rider name, category in large text

### Queue display (bottom half of screen)
- A list of the next 5 riders with their scheduled start times
- Format per row: start time | bib | rider name | category
- The top item in the queue (next after the current rider) is slightly larger or highlighted
- The list scrolls automatically as riders depart — no manual interaction needed

### End of start list
- When the last rider has departed, the screen shows: "All riders have started" with the time the last rider departed
- No further countdown is shown

### Wake lock
- On mount, request the browser Wake Lock API (`navigator.wakeLock.request('screen')`) to prevent the device screen from sleeping
- If wake lock is not supported or is denied, show a one-time dismissible notice: "Tip: disable auto-lock on this device to keep this screen on."
- Re-request wake lock if it is released (e.g. device tab becomes hidden and then visible again)

## Connectivity indicator
- The connectivity status component from Story 16 is shown at the top of this screen
- The session start timestamp write goes through the write queue (Story 15)

## Acceptance criteria
- [ ] Pre-start state shows stage info and a single Start TT button
- [ ] Pressing Start TT records the UTC timestamp and broadcasts via Realtime
- [ ] Countdown timer counts down to the next rider's departure
- [ ] Current rider (bib, name, category) is displayed prominently
- [ ] Next 5 riders are shown in a queue with their scheduled start times
- [ ] Queue advances automatically as riders depart — no interaction needed
- [ ] End-of-list state is shown when all riders have started
- [ ] Wake lock is requested on mount and re-requested if released
- [ ] Wake lock unavailable shows a dismissible tip
- [ ] Connectivity indicator is present

## Dependencies
- Story 11 (start order must be generated)
- Story 12 (start order may have been manually adjusted)
- Story 15 (write queue)
- Story 16 (connectivity indicator)

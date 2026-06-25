# Story 18 — TT finish line view

## Overview
The finish line view for a time trial. The operator taps STOP as each rider crosses the line, then assigns each captured time to a bib number. Multiple riders can be pending at once.

## User story
As the finish line operator, I need to capture each rider's finish time with a single tap and then assign it to a bib number so that I can record accurate times even when multiple riders arrive close together.

## Route
`/races/[slug]/stages/[stage]/live/tt/finish`

Requires authentication.

## Pre-session state
- If the TT session has not been started yet (no entry in `stage_category_starts`), the screen shows: "Waiting for the start line to begin the session…" with a loading indicator
- Once the session start is received via Supabase Realtime, the view transitions to the live state automatically

## Live state

### Running elapsed timer
- A running elapsed time display at the top of the screen (format: `H:MM:SS`)
- This is `Date.now() − sessionStartTimestamp` computed client-side every second
- The timer continues running whether or not there is a network connection

### STOP button
- A single large button occupying at least 40% of the screen height, labelled **STOP**
- Tapping STOP:
  1. Captures `elapsed_at = Date.now()` — client-side, before any async operation
  2. Creates a pending finish entry in the local pending list with the captured time
  3. Plays a short audio beep and/or vibrates the device (if supported) as immediate tactile confirmation
  4. The button is never disabled — it can be tapped again immediately

### Pending finish entries
- Shown as a scrollable list below the STOP button
- Each pending entry is a card showing:
  - Captured elapsed time (e.g. `1:23:45`)
  - A bib number input field (numeric keyboard on mobile)
  - A **Save** button
- Entries are in reverse chronological order (most recent at top)
- Entries can be resolved in any order

### Saving a pending entry
- Operator types the bib number into the input field
- Pressing **Save** (or Enter/Done on mobile keyboard):
  1. Validates the bib exists in the TT start order for this stage
  2. If valid: queues the result write via the write queue (Story 15) and removes the card from the pending list
  3. If bib not found: shows an inline error on the card ("Bib 99 is not in the start list") — card stays open
  4. If bib already saved: shows a warning ("Bib 42 already has a recorded time — overwrite?") with Confirm / Cancel

### End of session
- An **End session** button in the top navigation ends the live session for this stage
- If there are unresolved pending entries, show a warning: "You have X unresolved entries. Finish assigning bibs before ending the session."
- Ending the session transitions the stage to a completable state

## Connectivity indicator
- The connectivity status component from Story 16 is shown at the top
- All saves go through the write queue (Story 15)
- Pending entries are stored in local storage so a browser refresh does not lose them

## Acceptance criteria
- [ ] Pre-session state waits for Realtime broadcast from start line
- [ ] Elapsed timer runs from session start timestamp and is never blocked by network state
- [ ] STOP captures timestamp client-side before any async work
- [ ] STOP button is never disabled — tapping again immediately creates a new entry
- [ ] Audio/vibration feedback fires on each STOP tap
- [ ] Each pending entry shows captured time and a bib input
- [ ] Entries resolve in any order
- [ ] Invalid bib shows inline error and keeps the card open
- [ ] Duplicate bib shows a warning with overwrite confirmation
- [ ] Pending entries survive a browser refresh (local storage)
- [ ] End session warns if unresolved entries exist
- [ ] Connectivity indicator is present

## Dependencies
- Story 15 (write queue)
- Story 16 (connectivity indicator)
- Story 17 (TT session must be started before finish line goes live)

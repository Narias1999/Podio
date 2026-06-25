# Story 21 — Group stage finish line view

## Overview
The finish line view for a road/group stage. The operator taps STOP as each group crosses the line, adds the bib numbers for all riders in that group, orders them within the group, and saves. Multiple groups can be pending simultaneously.

## User story
As the finish line operator for a road stage, I need to capture the time a group finishes, add all the bibs in that group, set their order, and save them so that the results reflect the correct time and relative position for each rider.

## Route
`/races/[slug]/stages/[stage]/live/group/finish`

Requires authentication.

## Pre-session state
- Shows "Waiting for the start line to begin the session…" until at least one `stage_category_starts` entry is received via Supabase Realtime
- Transitions automatically once the first wave starts

## Live state

### Running elapsed timer
- Same as TT finish line — `Date.now() − earliestCategoryStartTimestamp` computed client-side
- When multiple waves exist (different categories started at different times), the timer shows the time since the first wave started — net time per rider is still calculated against their own category's `started_at`

### STOP button
- Large, dominant, always enabled — same behaviour as TT finish line
- Tapping STOP:
  1. Captures `elapsed_at = Date.now()` client-side immediately
  2. Creates a pending group entry in the local list
  3. Plays audio/vibration feedback
  4. Button is immediately available for the next tap

### Pending group entries
Each pending entry is a card showing:
- **Captured time** — the elapsed time at STOP tap (e.g. `2:14:33`)
- **Bib input** — a numeric text field; pressing Enter/Done adds the bib to the group and clears the field ready for the next bib
- **Rider chips** — each confirmed bib appears as a chip below the input (e.g. `#12`, `#45`, `#7`)
- **Reorder chips** — rider chips can be dragged left/right (or up/down on narrow screens) to set within-group finishing order; order is shown by chip position (left = first)
- **Save group** button — saves all riders in this group with the same captured time and removes the card
- **Discard** button — removes the pending entry without saving (with a confirmation: "Discard this group? The captured time will be lost.")

### Bib entry behaviour
- Bib-only input (no name search) — faster to type under pressure
- Each bib is validated on entry:
  - Bib exists in the race registration list → chip added
  - Bib not found → inline error below the input ("Bib 99 is not registered in this race"); field stays open
  - Bib already added to this group → silently ignored with a brief inline notice ("Already in this group")
  - Bib already saved in another group → warning on the chip: "⚠ Bib 42 already recorded" — still added but flagged; operator must resolve before saving
- Chips can be individually removed by tapping an × on the chip

### Saving a group
- At least one bib must be in the group to enable Save
- If any chip has the "already recorded" warning, show a confirmation before saving: "Bib 42 already has a result for this stage. Overwrite?"
- On save: enqueues one result write per rider (via write queue, Story 15) with the shared captured time and their within-group position as `group_position`
- Card is removed from pending list on save

### Pending list management
- Entries are in reverse chronological order (most recent STOP at top)
- Multiple entries can be open simultaneously — no limit
- Entries persist in local storage — a browser refresh does not lose them

## Connectivity indicator
- Connectivity status component (Story 16) at top of screen
- All saves go through the write queue

## Acceptance criteria
- [ ] Pre-session state waits for Realtime broadcast from start line
- [ ] STOP captures timestamp client-side and is never blocking
- [ ] Audio/vibration confirmation on each STOP tap
- [ ] Each pending card shows captured time, bib input, rider chips, and Save/Discard buttons
- [ ] Adding a bib creates a chip; chip is draggable to set within-group order
- [ ] Invalid bib shows inline error; field stays open
- [ ] Duplicate bib within same group is silently ignored with a brief notice
- [ ] Bib already saved in another group shows a warning chip but is still addable
- [ ] Saving with a duplicate bib warning requires confirmation
- [ ] At least one bib required to enable Save
- [ ] Discard requires confirmation
- [ ] Pending entries survive a browser refresh
- [ ] Connectivity indicator present

## Dependencies
- Story 15 (write queue)
- Story 16 (connectivity indicator)
- Story 20 (group stage session must be started before finish line goes live)

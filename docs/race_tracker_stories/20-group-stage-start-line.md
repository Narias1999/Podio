# Story 20 — Group stage start line view

## Overview
The start line view for a group/road stage. The operator selects which categories are starting and taps Start. That is the entirety of their interaction.

## User story
As the start line operator for a road stage, I need to select the categories that are starting and press Start so that the clock begins for those riders.

## Route
`/races/[slug]/stages/[stage]/live/group/start`

Requires authentication.

## Screen layout

### Category selector
- A list of all categories registered for this race, each shown as a large tappable chip/toggle
- Tapping a chip toggles it selected/deselected
- Selected chips are visually highlighted
- At least one category must be selected before the Start button is enabled
- An inline hint: "Select all categories that will start together, then press Start."

### Start button
- A large **Start** button below the category selector
- Disabled until at least one category is selected
- Tapping Start:
  1. Captures the current UTC timestamp
  2. Writes the timestamp as `started_at` to `stage_category_starts` for each selected category via the write queue (Story 15)
  3. Broadcasts the start event via Supabase Realtime so the finish line view syncs
  4. The selected categories are marked as started on this screen — their chips become locked with a ✓ "Started" label and the Start button resets

### Multiple waves
- After starting one wave, the operator can select a new set of categories and press Start again for the next wave
- Each wave writes its own `started_at` timestamp for the newly selected categories
- Already-started categories are locked and cannot be selected again
- A log at the bottom of the screen shows each wave: "Elite Men, Elite Women — started at 10:00:32"

### Wake lock
- Same behaviour as Story 17 — wake lock requested on mount, re-requested if released

## Connectivity indicator
- Connectivity status component (Story 16) shown at top of screen
- All start timestamp writes go through the write queue

## Acceptance criteria
- [ ] All race categories shown as selectable chips
- [ ] Start button disabled until at least one category is selected
- [ ] Tapping Start captures UTC timestamp and writes to `stage_category_starts` for each selected category
- [ ] Start event broadcast via Realtime
- [ ] Started categories lock immediately after the tap
- [ ] Operator can start a second wave — remaining categories still selectable
- [ ] Wave log shows each started group with its timestamp
- [ ] Wake lock requested on mount
- [ ] Connectivity indicator present

## Dependencies
- Story 05 (categories must exist)
- Story 15 (write queue)
- Story 16 (connectivity indicator)

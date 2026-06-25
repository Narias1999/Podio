# Story 08 — Manual results entry

## Overview
Organizers can enter stage results manually, rider by rider, for any stage that is not being tracked live. This is the fallback entry method for road stages where live tracking was not used.

## User story
As a race organizer, I need to manually enter the results for a stage so that I can record finishing times and positions even when live tracking was not used.

## Behaviour

### Results entry screen
- Accessible from the race management page: `/races/[slug]/manage/stages/[stage]/results`
- Shows a list of all confirmed riders registered for this race, with one row per rider
- Columns: bib number, rider name, category, finish time input, position input, status selector
- Riders are grouped by category with a category header row
- DNS riders are shown at the bottom of their category group, pre-filled with status `dns`, time and position fields disabled

### Inputs per rider
- **Finish time** — text input accepting `HH:MM:SS` or `H:MM:SS` format; shown with a placeholder "e.g. 3:42:15"
- **Position** — numeric input; must be unique within the category
- **Status** — segmented control or dropdown: Finished / DNF / DSQ / DNS
  - Selecting DNF or DSQ disables the finish time and position fields and shows an optional reason text input
  - Selecting DNS is pre-set for DNS-registered riders and cannot be changed here (DNS status is managed on the registration)

### Validation
- Finish time is required if status is Finished
- Positions must be unique within each category — duplicate position shows an inline error
- Positions must be sequential starting from 1 — gaps are warned but not blocked (e.g. if a DSQ removes a position mid-range)

### Saving
- Results are saved per-rider on blur or on an explicit **Save** button per row — not a single submit for the whole page
- A **Save all** button at the top saves all unsaved changes at once
- Saved rows show a subtle ✓ indicator
- The page does not need to be completed in one session — partial results are valid

### Marking stage complete
- A **Mark stage as completed** button appears once every confirmed rider (excluding DNS) has a result
- This transitions the stage to `completed` status
- After completion, results are read-only; an **Unlock results** button allows the organizer to re-open editing with a confirmation warning

## Acceptance criteria
- [ ] All registered riders appear grouped by category
- [ ] DNS riders are pre-filled and their time/position fields are disabled
- [ ] Finish time accepts `H:MM:SS` and `HH:MM:SS` formats
- [ ] DNF and DSQ disable time and position and show an optional reason input
- [ ] Duplicate positions within a category show an inline error
- [ ] Results save per-row and the whole page can be saved at once
- [ ] Mark stage as completed button appears only when all non-DNS riders have a result
- [ ] Completed stage results are read-only with an Unlock option

## Dependencies
- Story 06 or 07 (riders must be registered before results can be entered)
- Story 04 (stages must exist)

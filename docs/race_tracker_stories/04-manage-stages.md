# Story 04 — Manage stages

## Overview
Organizers add and configure the stages of a race. Single-stage races have one stage auto-created. Multi-stage races allow adding, naming, typing, and reordering stages.

## User story
As a race organizer, I need to configure the stages of my race so that results can be tracked per stage and the correct timing logic is applied to each one.

## Behaviour

### Single-stage races
- One stage is automatically created on race save with `stage_number = 1`
- The organizer can edit the stage name, date, distance, and type from the race management page
- No add/remove/reorder controls are shown

### Multi-stage races
- The race management page shows a stage list with an **Add stage** button
- Each stage has:
  - Stage number (auto-assigned in order, recalculates on reorder)
  - Name (e.g. "Stage 1 – Prologue", "Stage 3 – Mountain TT")
  - Date
  - Distance in km (optional)
  - Stage type: Road, Time Trial, Criterium, Mountain, Sprint
- Stages can be reordered via drag-and-drop; stage numbers update automatically
- A stage can be deleted if it has no results yet; if it has results a warning is shown and deletion is blocked
- At least one stage must always exist

### Stage type selection
Stage type is shown as a set of clearly labelled buttons (not a dropdown) with a brief description of each:
- **Road** — standard mass-start road stage
- **Time Trial** — individual start, riders race against the clock
- **Criterium** — multiple laps of a short circuit
- **Mountain** — high-altitude road stage
- **Sprint** — short, flat, high-speed stage

Selecting **Time Trial** shows an additional inline note: "This stage will have a generated start order and live TT tracking."

### Stage status
Each stage has a derived display status shown on the management page:
- **Upcoming** — no results yet, date is in the future
- **Live** — a live tracking session is active for this stage
- **Completed** — results have been entered and the stage is marked done

## Route
Stage management lives within the race management page at `/races/[slug]/manage` as a stages section — not a separate route.

## Acceptance criteria
- [ ] Single-stage races auto-create one stage and hide add/remove/reorder controls
- [ ] Multi-stage races allow adding, editing, reordering, and deleting stages
- [ ] Stage numbers update correctly after a reorder
- [ ] Deleting a stage with existing results is blocked with a clear warning
- [ ] Stage type buttons include a short description of each type
- [ ] Selecting Time Trial shows the TT note
- [ ] Stage display status (Upcoming / Live / Completed) is shown on the management page

## Dependencies
- Story 03 (race must exist before stages can be managed)

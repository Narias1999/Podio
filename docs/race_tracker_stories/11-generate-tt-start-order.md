# Story 11 — Generate TT start order

## Overview
For stages marked as time trials, the organizer generates a start order list. The generation logic differs depending on whether the TT is the first stage or a mid-race stage.

## User story
As a race organizer, I need to generate a start order for a time trial stage so that every rider has an assigned start position and scheduled start time.

## Behaviour

### Entry point
- Accessible from the race management page: `/races/[slug]/manage/stages/[stage]/start-order`
- Only shown for stages with `stage_type = 'time_trial'`
- Registration must be closed and bibs assigned first (Story 06): the start order lists each rider's bib, so if `races.registrations_closed` is false the page shows a prompt to close registration and assign bibs before generating
- If no start order has been generated yet, the page shows a configuration panel and a **Generate start order** button

### Configuration (before generation)
- **Start interval** — number of seconds between consecutive riders (numeric input, e.g. 60, 90, 120); default 60
- **Gap between categories** — additional seconds between the last rider of one category and the first of the next (numeric input, e.g. 300 for 5 minutes); default 300
- **First rider start time** — time of day the first rider departs (time input, e.g. `10:00:00`)

### Generation logic

**Opening TT (stage_number = 1 or no prior stages have results):**
- Riders are grouped by category in the category sort order defined on the race (index 0 = starts first)
- Within each category, riders are ordered randomly
- All riders with registration status `dns` are excluded from the start order

**Mid-race TT (at least one prior stage has completed results):**
- Riders grouped by category in the same category sort order
- Within each category, riders ordered by inverse GC position — the category GC leader starts last
- Riders excluded from GC (any DNF/DSQ/DNS on a prior stage) are excluded from the start order

### Start time calculation
- Rider at position 1: start time = configured first rider start time
- Rider at position N (within same category): start time = position 1 start time + (N − 1) × interval
- First rider of next category: start time = last rider of previous category start time + interval + gap between categories

### After generation
- The generated list is displayed as a table: position, start time, bib, rider name, team, category
- Configuration values (interval, gap, first start time) are shown as a summary and can be edited — doing so requires regenerating the list (with a confirmation warning that manual reordering will be lost)
- The **Regenerate** button is available at any time until the stage is marked as started

## Acceptance criteria
- [ ] Generation is blocked until registration is closed and bibs are assigned, with a clear prompt
- [ ] Configuration panel shows interval, gap, and first start time inputs with sensible defaults
- [ ] Opening TT uses random within-category order
- [ ] Mid-race TT uses inverse GC order within each category
- [ ] DNS riders are excluded from the start order
- [ ] Start times are correctly calculated from position, interval, and gap
- [ ] Regenerating shows a warning that manual changes will be lost
- [ ] Configuration values are displayed as a summary after generation

## Dependencies
- Story 06 or 07 (riders must be registered)
- Story 10 (GC must be calculable for mid-race TT logic)

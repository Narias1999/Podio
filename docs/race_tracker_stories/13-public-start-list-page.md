# Story 13 — Public start list page

## Overview
The TT start order is publicly accessible so that riders, spectators, and team staff can see who starts when without needing to contact the organizer.

## User story
As a rider or spectator, I need to view the time trial start order online so that I know when each rider is due to start.

## Behaviour

### Route
`/races/[slug]/stages/[stage]/startlist`

No authentication required. There is no RLS (Story 01): the page reads its data through a server component / public read endpoint that only returns data for `published` or `completed` races; draft races return 404.

### Page content
- Race name and stage name in the header
- Stage date and configured start interval displayed as metadata (e.g. "Riders start every 60 seconds")
- Start list table with columns: start position, start time, bib number, rider name, team, category
- Rows grouped by category with a category header row
- The table is sortable by start time (default), position, or bib number
- On mobile, the table collapses to a card-per-rider layout

### Filter
- A category filter above the table allows viewers to narrow to a single category
- Useful for team staff tracking only their riders

### Export
- A **Download PDF** button generates a print-ready PDF of the full start list
- A **Download CSV** button exports all rows in the same order
- Both exports include all columns and all categories regardless of active filter

### Not-yet-generated state
- If no start order has been generated for this stage, the public page shows: "The start order for this stage has not been published yet. Check back closer to race day."

### Real-time updates
- If the organizer updates the start order after the page is loaded, the page reflects changes on next load (no real-time push needed for the start list — it is generated ahead of time and changes are infrequent)

## Acceptance criteria
- [ ] Page is accessible without login
- [ ] Start list table shows all riders in start order grouped by category
- [ ] Stage metadata (date, interval) is shown
- [ ] Category filter narrows the visible rows
- [ ] Table is sortable by start time, position, and bib number
- [ ] Mobile layout switches to card-per-rider
- [ ] PDF and CSV export work and include all riders
- [ ] Pre-generation state shows a clear "not yet published" message

## Dependencies
- Story 11 (start order must be generated)

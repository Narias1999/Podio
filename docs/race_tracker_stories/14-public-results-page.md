# Story 14 — Public results page

## Overview
A publicly accessible results page for each race. Shows stage results and, for multi-stage races, GC standings. Updates in real time during live tracking sessions.

## User story
As a spectator or rider, I need to view the race results online so that I can follow standings without needing access to the organizer's tools.

## Behaviour

### Routes
- Race results index: `/races/[slug]/results`
- Stage-specific results: `/races/[slug]/stages/[stage]/results`

No authentication required. Only races with status `published` or `completed` are accessible — draft races return a 404. There is no RLS (Story 01): draft protection is enforced here, in the server component / public read endpoint that backs these routes, not by row-level security. The real-time subscription below uses Supabase Realtime with the anon key; exposing finished/forthcoming results to anon subscribers is accepted for v1 (the data is public once the race is published).

### Race results index
- Race name, discipline, location, and date(s) in the header
- Banner image if provided
- List of stages with their status: Upcoming / Live / Completed
- Clicking a completed stage navigates to the stage results page
- For multi-stage races, a **GC Standings** tab is shown alongside the stage list

### Stage results page
- Stage name, type, date, and distance in the header
- Results table columns: position, bib number, rider name, team, finish time (or net time for TT stages), gap to leader, status
- Rows grouped by category with a category header row
- DNF, DSQ, and DNS riders shown below the finishers in their category group
- Gap to leader: shown as `+ H:MM:SS`; leader shows `—`
- For TT stages: "net time" label instead of "finish time" with an inline tooltip explaining the difference
- Category filter above the table
- Mobile-friendly card layout

### GC standings tab (multi-stage races)
- Same table structure: position, bib, rider name, team, total time, gap to leader
- Grouped by category
- Non-finishers listed below with their elimination stage and reason

### Live state
- When a stage has an active live tracking session, a **Live** badge is shown on the race results index next to that stage
- The stage results page for a live stage auto-updates in real time via Supabase Realtime subscription as results are saved at the finish line
- A subtle "Last updated X seconds ago" indicator shows recency

### Empty state
- If a stage has no results yet: "Results for this stage haven't been published yet."
- If the race has no completed stages: "No results are available yet. Check back after the race."

## Acceptance criteria
- [ ] Page accessible without login
- [ ] Draft races return 404
- [ ] Stage list shows status for each stage
- [ ] GC tab only shown for multi-stage races
- [ ] Results grouped by category with finishers above DNF/DSQ/DNS
- [ ] Gap to leader calculated correctly
- [ ] TT stages show net time with tooltip
- [ ] Live badge shown for stages with an active session
- [ ] Results page auto-updates in real time during a live session
- [ ] Mobile card layout works correctly
- [ ] Empty states shown when no results are available

## Dependencies
- Story 08 or 09 (results must exist to display)
- Story 10 (GC for multi-stage tab)

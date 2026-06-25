# Story 10 — GC aggregation

## Overview
For multi-stage races, the General Classification (GC) is automatically computed as the cumulative sum of each rider's stage times. This is a derived computation, not a separately entered result.

## User story
As a race organizer, I need the app to automatically calculate and display the General Classification standings across all completed stages so that I don't have to compute cumulative times manually.

## Behaviour

### GC calculation
- GC is only shown for multi-stage races
- GC time for a rider = sum of `net_seconds` across all completed stages where the rider's result status is `finished`
- Riders with a `dnf` or `dsq` result on any stage are excluded from the GC standings and shown in a separate "Non-finishers" section
- Riders who are `dns` on a stage are also excluded from GC
- GC is calculated and updated automatically whenever a stage result is saved or updated
- GC is calculated per category — riders are not ranked across categories in the GC

### GC standings display (organizer view)
- A **GC Standings** tab is shown on the race management page for multi-stage races
- Columns: overall position, bib number, rider name, team, category, total time, gap to leader
- Gap to leader: shown as `+ H:MM:SS` relative to the category leader; leader shows `—`
- Grouped by category with a category header
- Non-finishers shown below the ranked riders with their last known status

### GC standings display (public view)
- Same data shown on the public results page under a GC tab (covered in Story 14)
- Updates in real time as stage results are entered during a live session

### Stage-by-stage breakdown
- On the organizer results screen, each rider's row can be expanded to show their time per stage
- This is a read-only view for reference

## Acceptance criteria
- [ ] GC tab only appears on multi-stage races
- [ ] GC times are the correct sum of `net_seconds` across all completed stages
- [ ] Riders with any DNF, DSQ, or DNS are excluded from ranked standings
- [ ] Non-finishers are listed separately with their status
- [ ] Gap to leader is shown correctly — leader has `—`, others show `+ H:MM:SS`
- [ ] GC updates automatically when any stage result is saved or edited
- [ ] GC is per category — no cross-category ranking

## Dependencies
- Story 08 (results must exist to calculate GC from)
- Story 04 (multi-stage race with at least two completed stages)

# Story 06 — Manual rider registration

## Overview
Organizers can add individual riders to a race, assign bib numbers and categories, and update or remove registrations one at a time.

## User story
As a race organizer, I need to manually add riders to my race one by one so that I can handle late registrations or corrections without re-uploading a full CSV.

## Behaviour

### Rider list view
- Accessible from the race management page at `/races/[slug]/manage/riders`
- Shows a table of registered riders with columns: bib number, name, team, category, status (Confirmed / DNS)
- Before registration is closed, bibs are unassigned — the bib column shows "—" (or "Unassigned"); after closing, the assigned numbers are shown
- Search bar filters by name, document number, or bib number in real time
- Filter dropdown narrows by category
- Row count shown ("42 riders across 3 categories")

### Adding a rider
- **Add rider** button opens a slide-in panel or modal (not a new page)
- Fields:
  - Document number (required — the rider's natural identity; used to match an existing rider profile)
  - First name + last name (required)
  - Sex (required — Male / Female)
  - Date of birth (required)
  - Team / club (optional)
  - Nationality (optional)
  - EPS / health insurance (optional)
  - Phone (optional)
  - Category (required, dropdown showing the race's configured categories — **auto-suggested** from the rider's age at the race `starts_at` date and sex, but the organizer can override the selection)
- Bib number is **not** entered here — bibs are assigned in bulk when registration is closed (see *Closing registration & assigning bibs* below)
- On save:
  - A `riders` row is created, or **matched to an existing rider by `document_number`** (the global rider profile is reused if the document number already exists)
  - A `registrations` row is created linking the rider to the race with the chosen category, an empty bib, and status `confirmed`
- All writes go through Next.js route handlers (no direct client Supabase writes; Story 01 authorization model)

### Category auto-assignment
- When date of birth and sex are entered, the panel computes the rider's age at the race `starts_at` date and pre-selects the first category (in `sort_order`) whose age range and sex rule match
- If no category matches, no category is pre-selected and the organizer must pick one manually
- The organizer can always override the suggestion; the chosen `category_id` is what gets stored

### Editing a registration
- Clicking a row in the rider list opens the same panel pre-filled with the rider's data
- Organizer can update category, team, EPS, phone, status, and — once registration is closed — the bib number
- Document number, name, sex, and date of birth are not editable here (they belong to the rider profile) — a note explains this. (Bib edits before closing are not possible because none is assigned yet.)
- Editing a bib re-checks uniqueness within the race and shows an inline error on a clash

### Closing registration & assigning bibs
- A **Close registration & assign bibs** action is available on the rider list once at least one rider is registered
- On confirm, the system:
  - Takes the categories in `sort_order` and, for each, allocates a contiguous bib range sized to that category's confirmed-rider count (DNS riders excluded), so each category occupies one numeric range with no overlaps
  - Assigns bibs **randomly within each category's range** to that category's confirmed riders
  - Sets `races.registrations_closed = true`
- After closing, individual bibs can be edited inline (subject to the per-race uniqueness constraint), and late riders added afterward are given the next free bib (editable by the admin)
- The action shows a summary of the ranges assigned per category

### Marking DNS
- A quick-action **Mark DNS** toggle is available on each row without opening the edit panel
- DNS riders remain in the list but are visually distinguished (muted row, DNS badge)

### Removing a rider
- A remove button is available in the edit panel
- If the rider has no results for any stage, they are removed from the race (registration deleted)
- If the rider has results, removal is blocked: "This rider has results recorded. Delete their results first."

## Acceptance criteria
- [ ] Rider list shows bib (or "Unassigned" before close), name, team, category, and status with search (name / document number / bib) and filter
- [ ] Add rider panel opens without navigating away and collects document number, name, sex, DOB (all required), plus optional team, nationality, EPS, phone
- [ ] No bib field is shown at add time
- [ ] Category is auto-suggested from age (at race start) + sex and is overridable; falls back to manual when nothing matches
- [ ] Rider is created or reused by matching `document_number`, and the registration is linked correctly
- [ ] Edit panel pre-fills all current values; document number, name, sex, and DOB are read-only
- [ ] "Close registration & assign bibs" assigns each category a contiguous range sized to its count and randomises bibs within it, then sets `registrations_closed`
- [ ] Bibs can be edited after closing, with per-race uniqueness enforced inline
- [ ] DNS can be toggled from the list row without opening the edit panel
- [ ] Removing a rider with results is blocked with a clear explanation
- [ ] Row count reflects current search/filter state

## Dependencies
- Story 03 (race)
- Story 05 (categories must exist to assign riders)

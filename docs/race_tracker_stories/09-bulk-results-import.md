# Story 09 — Bulk results import via CSV

## Overview
Organizers can upload a CSV of stage results as an alternative to manual entry. Follows the same wizard pattern as rider import.

## User story
As a race organizer, I need to upload results for a stage via CSV so that I can quickly import results from an external timing system without entering them one by one.

## Wizard steps

### Step 1 — Download template
- Template columns: `bib_number`, `finish_time`, `position`, `status`, `dnf_reason`, `dsq_reason`
- Required: `bib_number`, `status`
- Required if status is `finished`: `finish_time`, `position`
- Optional: `dnf_reason` (used when status is `dnf`), `dsq_reason` (used when status is `dsq`)
- Valid status values listed in the template header comment: `finished`, `dnf`, `dsq`, `dns`
- A sample row is included

### Step 2 — Upload file
- Drag-and-drop or file picker for `.csv` files
- Accepts comma and semicolon delimiters
- Parsed client-side on selection

### Step 3 — Preview & validate
- Table of all parsed rows with per-row validation status
- Validation rules:
  - `bib_number` exists in the race's registrations
  - `status` is one of the valid values
  - `finish_time` is present and valid format (`H:MM:SS` or `HH:MM:SS`) when status is `finished`
  - `position` is a positive integer when status is `finished`
  - Positions are unique within each category across all rows
  - No bib appears more than once in the file
- Errors shown inline per cell with plain-language descriptions
- Import is blocked if any row has an error
- **Re-upload file** button returns to step 2

### Step 4 — Confirm & summary
- All rows written atomically on confirm
- Success screen shows: total results imported, breakdown by status (X finished, Y DNF, Z DSQ)
- **View results** button navigates to the manual results entry screen (now showing the imported values)

## Acceptance criteria
- [ ] Template is downloadable with correct columns, valid status values documented, and a sample row
- [ ] Comma and semicolon delimiters accepted
- [ ] All rows validated before any are committed
- [ ] Bib numbers validated against the race's registration list
- [ ] Duplicate positions within a category show an error
- [ ] Import is atomic
- [ ] Success summary shows counts by status

## Dependencies
- Story 07 (riders must be registered before results can reference their bibs)
- Story 08 (results screen must exist — user is redirected there on success)

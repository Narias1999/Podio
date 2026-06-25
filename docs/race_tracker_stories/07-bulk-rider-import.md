# Story 07 — Bulk rider import via CSV

## Overview
Organizers can upload a CSV file to register many riders at once. The import validates all rows before committing and provides clear error feedback per row.

## User story
As a race organizer, I need to upload a CSV of riders so that I can register a large number of participants quickly without entering them one by one.

## Wizard steps

### Step 1 — Download template
- The import flow starts with a prompt to download the CSV template
- Template has columns: `document_number`, `first_name`, `last_name`, `sex`, `date_of_birth`, `category`, `team`, `nationality`, `eps`, `phone`
- Columns `document_number`, `first_name`, `last_name`, `sex`, and `date_of_birth` are required; the rest are optional
- `category` is optional — when blank it is auto-assigned from the rider's age (at the race `starts_at` date) and sex; when present it overrides the auto-assignment
- There is **no** `bib_number` column — bibs are assigned in bulk when registration is closed (Story 06)
- A sample row is included in the template so organizers know the expected format
- After downloading, a **Upload your file** button advances to step 2

### Step 2 — Upload file
- Drag-and-drop area or file picker accepting `.csv` files
- Accepts both comma-delimited and semicolon-delimited files
- File is parsed client-side immediately on selection — no server call at this step
- If the file cannot be parsed (wrong format, empty file), a plain-language error is shown: "We couldn't read this file. Make sure it's saved as a CSV and try again."

### Step 3 — Preview & validate
- A table shows all parsed rows with a status indicator per row: ✓ valid or ✗ error
- Validation rules checked per row:
  - Required fields present and non-empty (`document_number`, `first_name`, `last_name`, `sex`, `date_of_birth`)
  - `sex` is one of `male` / `female` (case-insensitive)
  - `date_of_birth` is a valid date
  - `document_number` does not appear more than once in the file
  - `category`, if provided, matches one of the race's configured category names (case-insensitive)
  - If `category` is blank, a category can be resolved automatically from age + sex; if nothing matches, the row is flagged so the organizer fills the category in
- Errors are shown inline in the relevant cell with a short explanation
- A summary at the top shows: "48 rows ready to import, 3 rows have errors"
- If any row has errors, the **Confirm import** button is disabled
- Organizer must fix the file and re-upload — partial imports are not allowed
- A **Re-upload file** button returns to step 2 without losing the error context

### Step 4 — Confirm & summary
- On confirm, all rows are written to the database in a single transaction
- A success screen shows:
  - Total riders imported
  - Breakdown by category
  - Any automatic decisions made (e.g. "3 riders matched existing profiles by name and date of birth")
- A **View rider list** button navigates to the rider list

## Handling existing rider profiles
- On import, each row is matched against the `riders` table by `document_number`
- If a match is found, the existing rider profile is reused and only a new `registration` row is created
- If no match is found, a new `riders` row is created
- The import summary notes how many profiles were reused vs newly created

## Acceptance criteria
- [ ] CSV template is downloadable with the correct columns (no `bib_number`) and a sample row
- [ ] Comma and semicolon delimiters are both accepted
- [ ] Required fields (`document_number`, `first_name`, `last_name`, `sex`, `date_of_birth`) are validated; `sex` and `date_of_birth` formats are checked
- [ ] Blank `category` is auto-assigned from age + sex; unresolvable rows are flagged
- [ ] Duplicate `document_number` within the file is flagged
- [ ] All rows are validated before any are committed
- [ ] Errors are shown per row with plain-language explanations
- [ ] Confirm button is disabled when any row has an error
- [ ] Successful import shows a summary with totals per category
- [ ] Existing rider profiles are reused when `document_number` matches
- [ ] Import is atomic — either all rows succeed or none are committed

## Dependencies
- Story 05 (categories must exist for category validation)
- Story 06 (rider list page must exist — user is redirected there on success)

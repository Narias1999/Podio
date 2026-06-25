# Story 05 — Manage categories

## Overview
Organizers can edit the race's categories after race creation — adding new ones, renaming, reordering, or removing them — as long as no riders have been registered in the affected category.

## User story
As a race organizer, I need to manage the categories for my race after it has been created so that I can adjust them as registration details evolve.

## Behaviour

### Category list
- Categories are shown in their current sort order on the race management page
- Each row shows the category name, its optional age range / sex rule, and its sort order position
- Drag-to-reorder is available — the sort order determines TT start block order (index 0 = starts first)

### Adding a category
- An **Add category** button opens an inline form with a name field plus optional **age range** (`age_min`–`age_max`) and **sex** (Male / Female / any) inputs
- The new category is appended to the end of the list (last sort order position)
- Preset chips are offered as in the race wizard (quick-add from the default category set, each carrying its preset age/sex rules)

### Renaming / editing a category
- Inline edit on each row — click the name to edit in place; the age range and sex rule are editable from the same row
- Saving the name updates it across all associated registrations
- Changing a category's age/sex rule does **not** retroactively re-assign already-registered riders; it only affects future auto-assignment. A note reminds the organizer of this

### Removing a category
- A remove button is shown on each row
- If the category has no registrations, it is deleted immediately with no confirmation
- If the category has registrations, deletion is blocked with a plain-language warning: "This category has X riders registered. Remove them first before deleting the category."

### Sort order and TT start blocks
- An inline hint reminds the organizer: "Categories at the top of this list start first in time trials. Put your slowest category first."
- Sort order changes take effect immediately for any future start order generation; existing generated start orders are not retroactively changed

## Acceptance criteria
- [ ] Category list is shown in sort order with drag-to-reorder, showing each category's age/sex rule
- [ ] Adding a category with preset chips works in one tap and carries the preset's age/sex rules
- [ ] A category's age range and sex can be set and edited
- [ ] Editing a category's age/sex rule does not retroactively re-assign existing riders
- [ ] Renaming a category updates inline without a page reload
- [ ] Removing a category with no registrations deletes immediately
- [ ] Removing a category with registrations is blocked with a clear count and explanation
- [ ] The TT sort order hint is visible above the list

## Dependencies
- Story 03 (race must exist)

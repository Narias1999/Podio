# Story 03 — Create a race (wizard)

## Overview
Organizers create a new race through a step-by-step wizard. This is the entry point for all race data and must be approachable for non-technical users.

## User story
As a race organizer, I need to create a new race through a guided step-by-step form so that I don't have to fill in everything at once and can't miss required information.

## Wizard steps

### Step 1 — Basic info
Fields:
- Race name (required)
- Location (required)
- Start date (required)
- End date (optional — leave blank for single-day events)
- Description (optional, multiline)
- Banner image upload (optional)

Validation: name, location, and start date must be filled before proceeding.

### Step 2 — Discipline & format
Fields:
- Discipline: **Cycling** or **Running** (large toggle/radio buttons, not a dropdown)
- Format: **Single stage** or **Multi-stage** (large toggle/radio buttons)

Inline hint: "Multi-stage races allow you to track results across multiple days and display a General Classification (GC) standings."

### Step 3 — Categories
- The step is **pre-populated** with the shared default category set (Story 01) so most organizers can move on without changes; any default can be renamed, removed, or edited
- Organizer adds one or more categories for the race (e.g. Elite Men, Elite Women, Masters 40+)
- Each category has:
  - A name and a sort order (drag-to-reorder)
  - Optional **age range** (`age_min`–`age_max`, in years) and optional **sex** (Male / Female / any) — these drive automatic category assignment for riders (Stories 06/07). A category may set age range only, sex only, both, or neither (manual-only)
- Sort order determines TT start order: top of the list = starts first (slowest category)
- At least one category is required before proceeding
- The same default set is also offered as quick-add chips (e.g. "Elite Men", "Elite Women", "Sub-23", "Masters 40+", "Masters 50+"), each carrying its preset age/sex rules — tapping a preset adds it to the list; organizer can rename, edit, or remove any of them

### Step 4 — Review & publish
- Summary of all entered data: name, dates, location, discipline, format, categories in order
- Two action buttons:
  - **Save as draft** — saves the race with status `draft`; not publicly visible
  - **Publish race** — saves with status `published`; the results page becomes publicly accessible

## Slug generation
- The race slug is auto-generated from the race name on save (e.g. "Tour de Bogotá 2026" → `tour-de-bogota-2026`)
- If a slug collision occurs, append a short numeric suffix (e.g. `-2`)
- Slug is not user-editable in v1

## Dashboard
- After creation the organizer is taken to the race management page at `/races/[slug]/manage`
- `/dashboard` lists all races owned by the organizer as cards showing: name, date, discipline, status badge
- A **Create new race** button links to the wizard

## Acceptance criteria
- [ ] Wizard has 4 steps with a progress indicator showing current step
- [ ] User cannot proceed past a step with unfilled required fields; error messages are shown inline
- [ ] Categories step is pre-populated with the default category set; defaults can be edited or removed
- [ ] Category list supports drag-to-reorder
- [ ] Each category can carry an optional age range and/or sex
- [ ] Preset category chips (carrying their age/sex rules) are offered and can be added in one tap
- [ ] Save as draft and Publish both work and set the correct status
- [ ] Slug is auto-generated and unique
- [ ] After save the organizer lands on the race management page
- [ ] Dashboard lists all the organizer's races

## Dependencies
- Story 01 (schema)
- Story 02 (auth — organizer must be logged in)

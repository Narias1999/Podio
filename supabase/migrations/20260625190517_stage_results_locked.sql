-- Podio — manual results entry (Story 08)
--
-- Story 04 describes a stage's display status as Upcoming / Live / Completed,
-- where "Completed" means "results have been entered AND the stage is marked
-- done" — a deliberate organizer action, not merely "has at least one result".
-- No existing column captures that action, so this adds an explicit lock flag
-- set by the "Mark stage as completed" button and cleared by "Unlock results"
-- (Story 08). Defaults to false so all existing stages remain editable.
alter table stages
  add column results_locked boolean not null default false;

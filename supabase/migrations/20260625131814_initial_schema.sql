-- Podio — initial database schema (Story 01)
--
-- Authorization model: Row-Level Security (RLS) is INTENTIONALLY NOT ENABLED on any
-- table in this schema. All writes go through Next.js route handlers under app/api/...
-- which authenticate the Supabase server session, verify the user owns the target race
-- (races.organizer_id = session.user.id), and perform the write with a service-role
-- client (lib/supabase/admin.ts). Public/draft-race protection is enforced at the
-- page/endpoint layer, not by RLS. This is accepted for v1 because organizers are the
-- only writers. Do NOT enable RLS here.

-- ============================================================================
-- races
-- ============================================================================
create table races (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  organizer_id         uuid not null references auth.users(id),
  name                 text not null,
  slug                 text not null unique,
  discipline           text not null check (discipline in ('cycling', 'running')),
  location             text not null,
  description          text,
  banner_url           text,
  status               text not null default 'draft' check (status in ('draft', 'published', 'completed')),
  is_multi_stage       boolean not null default false,
  starts_at            date not null,
  ends_at              date,
  -- set true by the "close registration & assign bibs" action; bibs are assigned at this point
  registrations_closed boolean not null default false
);

-- ============================================================================
-- stages
-- ============================================================================
create table stages (
  id           uuid primary key default gen_random_uuid(),
  race_id      uuid not null references races(id) on delete cascade,
  stage_number integer not null,
  name         text not null,
  date         date not null,
  distance_km  numeric,
  stage_type   text not null check (stage_type in ('road', 'time_trial', 'criterium', 'mountain', 'sprint'))
);

-- ============================================================================
-- categories
-- age_min / age_max / sex are optional auto-assignment rules. A category may use any
-- combination: age range only, sex only, both, or neither (manual-only). age_min/age_max
-- are inclusive bounds in years, evaluated against the rider's age at the race's starts_at.
-- ============================================================================
create table categories (
  id         uuid primary key default gen_random_uuid(),
  race_id    uuid not null references races(id) on delete cascade,
  name       text not null,
  sort_order integer not null,
  age_min    integer,
  age_max    integer,
  sex        text check (sex in ('male', 'female'))
);

-- ============================================================================
-- stage_category_starts
-- Start timestamp per category per stage. Used for net time calculation in TT and group stages.
-- ============================================================================
create table stage_category_starts (
  id          uuid primary key default gen_random_uuid(),
  stage_id    uuid not null references stages(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  started_at  timestamptz not null,
  unique (stage_id, category_id)
);

-- ============================================================================
-- riders
-- Riders are global (shared across races). document_number is the natural identity used
-- to dedupe and match a rider across races and on CSV import.
-- ============================================================================
create table riders (
  id              uuid primary key default gen_random_uuid(),
  document_number text not null unique,
  name            text not null,
  nationality     text,
  team            text,
  sex             text not null check (sex in ('male', 'female')),
  date_of_birth   date not null,
  eps             text,
  phone           text
);

-- ============================================================================
-- registrations
-- ============================================================================
create table registrations (
  id          uuid primary key default gen_random_uuid(),
  race_id     uuid not null references races(id) on delete cascade,
  rider_id    uuid not null references riders(id),
  -- auto-suggested from age + sex, but stored and overridable
  category_id uuid not null references categories(id),
  -- null until registration is closed and bibs are assigned
  bib_number  integer,
  status      text not null default 'confirmed' check (status in ('confirmed', 'dns')),
  -- nulls allowed (multiple unassigned registrations coexist)
  unique (race_id, bib_number)
);

-- ============================================================================
-- tt_start_order
-- ============================================================================
create table tt_start_order (
  id              uuid primary key default gen_random_uuid(),
  stage_id        uuid not null references stages(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete cascade,
  position        integer not null,
  start_time      timestamptz,
  unique (stage_id, registration_id),
  unique (stage_id, position)
);

-- ============================================================================
-- results
-- ============================================================================
create table results (
  id              uuid primary key default gen_random_uuid(),
  stage_id        uuid not null references stages(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete cascade,
  finish_time     timestamptz,
  elapsed_seconds numeric,
  net_seconds     numeric,
  position        integer,
  -- tiebreaker within a same-time group (group stages only)
  group_position  integer,
  status          text not null default 'finished' check (status in ('finished', 'dnf', 'dsq', 'dns')),
  dnf_reason      text,
  dsq_reason      text,
  -- client-side capture timestamp (for offline queue ordering)
  captured_at     timestamptz,
  unique (stage_id, registration_id)
);

-- Helpful indexes for common lookups (foreign-key joins).
create index idx_stages_race_id on stages(race_id);
create index idx_categories_race_id on categories(race_id);
create index idx_stage_category_starts_stage_id on stage_category_starts(stage_id);
create index idx_registrations_race_id on registrations(race_id);
create index idx_registrations_rider_id on registrations(rider_id);
create index idx_registrations_category_id on registrations(category_id);
create index idx_tt_start_order_stage_id on tt_start_order(stage_id);
create index idx_results_stage_id on results(stage_id);

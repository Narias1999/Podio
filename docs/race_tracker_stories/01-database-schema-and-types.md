# Story 01 — Database schema & types

# Updates

The following changes were requested after the original draft. They are **applied below** — the schema, types, authorization model, and acceptance criteria in this story reflect them, and the affected downstream stories (02, 03, 05, 06, 07, 11, 13, 14, 15, 19, 22) have been updated to match. The no-RLS authorization model (update 6) is cross-cutting: organizer writes in every story (including 08, 09, 12) go through Next.js route handlers, but those stories needed no wording changes beyond what is stated here and in Story 02.

1. **Rider document number.** Riders gain a `document_number` (national ID / passport). The uuid `id` stays as the technical primary key (all foreign keys reference `riders(id)` unchanged), but `document_number` is `not null unique` and is the **natural identity** used to dedupe and match riders across races (replacing the old name + date-of-birth match).
2. **More rider fields.** Add `eps` (text, optional — health insurance provider), `phone` (text, optional). `date_of_birth` becomes **required** (`not null`).
3. **Random bib assignment by category.** Bib numbers are no longer typed in at registration time. Registrations are created with an empty bib. When the organizer **closes registration** for the race, the system blocks out a contiguous bib range per category automatically (categories taken in `sort_order`, each range sized to that category's confirmed-rider count) and assigns bibs randomly within each category's range, so every rider in a category shares one numeric range. Admins can edit individual bibs afterward.
4. **Age + sex driven categories.** A category often corresponds to an age range and/or a sex (e.g. "10–12 years", "Elite Women"). Categories gain optional `age_min`, `age_max`, and `sex`. Riders gain a required `sex`. On registration the category is **auto-suggested** from the rider's age (computed at the race's `starts_at` date) and sex, but the chosen `category_id` is still **stored on the registration** so the organizer can override it.
5. **Default categories seed.** Provide a shared set of default category definitions (name + optional age range + optional sex) that pre-populates a new race's categories, since most races reuse the same set.
6. **No RLS — authorization in Next.js endpoints.** Do not use Postgres row-level security. All write operations go through Next.js route handlers that authorize the request (only authenticated organizers may write, and only to their own races). This is acceptable for v1 because admins are the only writers. See the *Authorization model* section below.

## Overview
Define the full Supabase database schema and shared TypeScript types that all subsequent stories depend on. Nothing else can be built until this is in place.

## User story
As a developer, I need a complete database schema and matching TypeScript types so that all features have a consistent, reliable data foundation.

## Schema

### `races`
```sql
id            uuid primary key default gen_random_uuid()
created_at    timestamptz default now()
organizer_id  uuid references auth.users(id) not null
name          text not null
slug          text not null unique
discipline    text not null check (discipline in ('cycling', 'running'))
location      text not null
description   text
banner_url    text
status        text not null default 'draft' check (status in ('draft', 'published', 'completed'))
is_multi_stage boolean not null default false
starts_at     date not null
ends_at       date
registrations_closed boolean not null default false  -- set true by the "close registration & assign bibs" action; bibs are assigned at this point
```

### `stages`
```sql
id            uuid primary key default gen_random_uuid()
race_id       uuid references races(id) on delete cascade not null
stage_number  integer not null
name          text not null
date          date not null
distance_km   numeric
stage_type    text not null check (stage_type in ('road', 'time_trial', 'criterium', 'mountain', 'sprint'))
```

### `categories`
`age_min`, `age_max`, and `sex` are the optional auto-assignment rules. A category may use any combination: age range only (e.g. 10–12), sex only (e.g. Elite Women), both, or neither (manual-only category). `age_min`/`age_max` are inclusive bounds in years, evaluated against the rider's age at the race's `starts_at` date.
```sql
id            uuid primary key default gen_random_uuid()
race_id       uuid references races(id) on delete cascade not null
name          text not null
sort_order    integer not null
age_min       integer            -- optional inclusive lower age bound (years)
age_max       integer            -- optional inclusive upper age bound (years)
sex           text check (sex in ('male', 'female'))  -- optional: restricts the category to one sex
```

### `stage_category_starts`
Stores the start timestamp per category per stage. Used for net time calculation in both TT and group stages.
```sql
id            uuid primary key default gen_random_uuid()
stage_id      uuid references stages(id) on delete cascade not null
category_id   uuid references categories(id) on delete cascade not null
started_at    timestamptz not null
unique (stage_id, category_id)
```

### `riders`
Riders are global (shared across races). `document_number` is the natural identity used to dedupe and match a rider across races and on CSV import.
```sql
id              uuid primary key default gen_random_uuid()
document_number text not null unique          -- national ID / passport; natural match key
name            text not null
nationality     text
team            text
sex             text not null check (sex in ('male', 'female'))
date_of_birth   date not null
eps             text                           -- optional: health insurance provider
phone           text                           -- optional
```

### `registrations`
```sql
id            uuid primary key default gen_random_uuid()
race_id       uuid references races(id) on delete cascade not null
rider_id      uuid references riders(id) not null
category_id   uuid references categories(id) not null  -- auto-suggested from age + sex, but stored and overridable
bib_number    integer                                  -- null until registration is closed and bibs are assigned
status        text not null default 'confirmed' check (status in ('confirmed', 'dns'))
unique (race_id, bib_number)                            -- nulls allowed (multiple unassigned registrations coexist)
```

### `tt_start_order`
```sql
id            uuid primary key default gen_random_uuid()
stage_id      uuid references stages(id) on delete cascade not null
registration_id uuid references registrations(id) on delete cascade not null
position      integer not null
start_time    timestamptz
unique (stage_id, registration_id)
unique (stage_id, position)
```

### `results`
```sql
id                uuid primary key default gen_random_uuid()
stage_id          uuid references stages(id) on delete cascade not null
registration_id   uuid references registrations(id) on delete cascade not null
finish_time       timestamptz
elapsed_seconds   numeric
net_seconds       numeric
position          integer
group_position    integer  -- tiebreaker within a same-time group (group stages only)
status            text not null default 'finished' check (status in ('finished', 'dnf', 'dsq', 'dns'))
dnf_reason        text
dsq_reason        text
captured_at       timestamptz  -- client-side capture timestamp (for offline queue ordering)
unique (stage_id, registration_id)
```

## TypeScript types

Create `/types/database.ts` exporting a `Database` type generated via the Supabase CLI:
```bash
npx supabase gen types typescript --project-id <project-id> > types/database.ts
```

Create `/types/app.ts` with convenience aliases used throughout the app:
```ts
export type Race = Database['public']['Tables']['races']['Row']
export type Stage = Database['public']['Tables']['stages']['Row']
export type Category = Database['public']['Tables']['categories']['Row']
export type StageCategoryStart = Database['public']['Tables']['stage_category_starts']['Row']
export type Rider = Database['public']['Tables']['riders']['Row']
export type Registration = Database['public']['Tables']['registrations']['Row']
export type TtStartOrder = Database['public']['Tables']['tt_start_order']['Row']
export type Result = Database['public']['Tables']['results']['Row']

export type StageType = 'road' | 'time_trial' | 'criterium' | 'mountain' | 'sprint'
export type RaceStatus = 'draft' | 'published' | 'completed'
export type ResultStatus = 'finished' | 'dnf' | 'dsq' | 'dns'
export type Discipline = 'cycling' | 'running'
export type Sex = 'male' | 'female'
```

## Authorization model (no RLS)

Row-level security is **not** used. All authorization is enforced in Next.js route handlers. This is acceptable for v1 because organizers are the only writers.

### Writes
- Every mutation goes through a Next.js route handler (`/app/api/...`) — never a direct client-side Supabase write.
- The handler authenticates the request via the Supabase server session (`@supabase/ssr`), confirms the user owns the target race (`races.organizer_id = session.user.id`), then performs the write using a privileged server-side Supabase client (service role).
- The live tracking write queue (Story 15) flushes by POSTing to these endpoints rather than writing to Supabase directly.

### Reads
- **Organizer reads** happen in server components / route handlers scoped to the session user's `organizer_id`.
- **Public reads** (results, start lists) happen in server components or public read endpoints that only ever return data for races with status `published` or `completed`; draft races return 404. Draft protection is enforced in this layer, not by RLS.

### Realtime
- The public results page subscribes to Supabase Realtime for live updates (Stories 14, 19, 22). Because RLS is off, the anon key can subscribe to changes on `results`, `registrations`, etc. This is accepted for v1 — the exposed data is non-sensitive race results that become public anyway. Draft-race privacy is still enforced at the page/endpoint layer, which is the only place a viewer can reach the data through the UI.

## Default categories seed

Provide a shared list of default category definitions used to pre-populate a new race (Stories 03/05). Each entry is name + optional `age_min`/`age_max` + optional `sex` — e.g. `Sub-12 (10–12)`, `Elite Men (male)`, `Elite Women (female)`, `Masters 40+ (male, 40–49)`. This list lives in code (a constant) or a seed table and is the single source for the wizard's preset chips and the auto-populated default category set.

## Acceptance criteria
- [ ] All tables created in Supabase with correct constraints and foreign keys
- [ ] `riders.document_number` is `not null unique`; `date_of_birth` and `sex` are `not null`; `eps` and `phone` exist and are optional
- [ ] `categories` has optional `age_min`, `age_max`, and `sex`
- [ ] `registrations.bib_number` is nullable; `races.registrations_closed` exists
- [ ] No RLS is enabled; the authorization model is enforced in Next.js route handlers as described above
- [ ] TypeScript types generated and committed
- [ ] Convenience aliases in `/types/app.ts` cover all tables (plus a `Sex` type)
- [ ] A shared default-categories list/seed exists and is used to pre-populate new races
- [ ] A seed script exists to populate a sample race with stages, categories, and riders for local development

## Dependencies
None — this is the first story.

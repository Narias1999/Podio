-- Podio — local development seed (Story 01)
--
-- Inserts a sample organizer, a multi-stage race with stages, the shared default
-- category set, sample riders, and registrations so the app has realistic data to
-- run against locally. Run with `supabase db reset` (applies migrations + this seed)
-- or `psql ... -f supabase/seed.sql` against a local stack.
--
-- NOTE: the default category set here MUST stay in sync with lib/default-categories.ts.

-- ---------------------------------------------------------------------------
-- Dev organizer (auth.users). Deterministic id so the seed is idempotent-friendly
-- for local development. Email: organizer@podio.dev
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'organizer@podio.dev',
  crypt('podio-dev-password', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sample race (multi-stage cycling)
-- ---------------------------------------------------------------------------
insert into races (
  id, organizer_id, name, slug, discipline, location, description,
  status, is_multi_stage, starts_at, ends_at, registrations_closed
)
values (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a1',
  'Vuelta a los Andes 2026',
  'vuelta-a-los-andes-2026',
  'cycling',
  'Bogotá, Colombia',
  'Carrera de prueba para desarrollo local.',
  'published', true,
  '2026-08-01', '2026-08-03', false
);

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------
insert into stages (id, race_id, stage_number, name, date, distance_km, stage_type)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 1, 'Prólogo - Contrarreloj', '2026-08-01', 8.5, 'time_trial'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 2, 'Etapa de montaña', '2026-08-02', 142.0, 'mountain'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1', 3, 'Etapa final', '2026-08-03', 120.0, 'road');

-- ---------------------------------------------------------------------------
-- Categories (shared default set — keep in sync with lib/default-categories.ts)
-- ---------------------------------------------------------------------------
insert into categories (id, race_id, name, sort_order, age_min, age_max, sex)
values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Infantil',          1, null, 12,   null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'Prejuvenil',        2, 13,   14,   null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', 'Juvenil',           3, 15,   16,   null),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b1', 'Sub-23 Masculino',  4, 17,   22,   'male'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000b1', 'Sub-23 Femenino',   5, 17,   22,   'female'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000b1', 'Elite Masculino',   6, 23,   29,   'male'),
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000b1', 'Elite Femenino',    7, 23,   29,   'female'),
  ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000b1', 'Master 30+',        8, 30,   39,   null),
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000b1', 'Master 40+',        9, 40,   49,   null),
  ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000000b1', 'Master 50+',       10, 50,   null, null);

-- ---------------------------------------------------------------------------
-- Riders (global). document_number is the natural identity.
-- ---------------------------------------------------------------------------
insert into riders (id, document_number, name, nationality, team, sex, date_of_birth, eps, phone)
values
  ('00000000-0000-0000-0000-0000000000e1', 'CC1001', 'Juan Pérez',      'CO', 'Team Andes',   'male',   '1998-03-12', 'Sura',      '3001112233'),
  ('00000000-0000-0000-0000-0000000000e2', 'CC1002', 'Carlos Gómez',    'CO', 'Team Andes',   'male',   '1996-07-25', 'Sanitas',   '3002223344'),
  ('00000000-0000-0000-0000-0000000000e3', 'CC1003', 'María Rodríguez', 'CO', 'Club Cumbre',  'female', '1999-11-02', 'Nueva EPS', '3003334455'),
  ('00000000-0000-0000-0000-0000000000e4', 'CC1004', 'Laura Martínez',  'CO', 'Club Cumbre',  'female', '2000-01-18', null,        null),
  ('00000000-0000-0000-0000-0000000000e5', 'CC1005', 'Andrés Torres',   'CO', null,           'male',   '1985-09-30', 'Compensar', '3005556677'),
  ('00000000-0000-0000-0000-0000000000e6', 'CC1006', 'Diego Sánchez',   'CO', null,           'male',   '2010-05-14', 'Sura',      null);

-- ---------------------------------------------------------------------------
-- Registrations. bib_number left null (registration not yet closed for this race).
-- ---------------------------------------------------------------------------
insert into registrations (id, race_id, rider_id, category_id, bib_number, status)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d6', null, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d6', null, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d7', null, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d7', null, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d9', null, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000d1', null, 'confirmed');

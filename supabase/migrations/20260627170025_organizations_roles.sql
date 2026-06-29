-- Podio — organizations, roles and invitations
--
-- Introduces multi-tenancy: every user belongs to exactly ONE organization and
-- has exactly ONE role. Races now belong to an organization (replacing the old
-- per-user `organizer_id` ownership model — `organizer_id` is kept only for
-- provenance). All members of an organization can access/manage its races.
--
-- Authorization model is unchanged otherwise: RLS stays OFF. All writes go
-- through Next.js route handlers under app/api/... that authenticate the
-- session, load the caller's profile (organization + role), and write with a
-- service-role client. See the authorization model in Story 01.

-- ============================================================================
-- Configuration
-- ----------------------------------------------------------------------------
-- The email below is granted the `super_admin` role during the backfill.
-- CHANGE THIS VALUE before running the migration if the platform owner differs.
-- (It is also referenced by the do-block below via a local variable.)
-- ============================================================================
-- super-admin email constant: nicolasarias870@gmail.com

-- ============================================================================
-- user_role enum
-- ----------------------------------------------------------------------------
-- Cumulative capability ladder:
--   operator    = create + fully manage races
--   admin       = everything operator can + invite users to their own org
--   super_admin = everything admin can + create new organizations
-- ============================================================================
create type user_role as enum ('super_admin', 'admin', 'operator');

-- ============================================================================
-- organizations
-- ============================================================================
create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- hard cap on number of members; enforced at invite time in the app layer
  max_users  integer not null default 5,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- profiles
-- One row per auth user. Binds the user to exactly one organization + role.
-- ============================================================================
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  role            user_role not null default 'operator',
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- races.organization_id
-- Added nullable for the backfill, then set NOT NULL afterwards.
-- ============================================================================
alter table races
  add column organization_id uuid references organizations(id);

-- ============================================================================
-- Backfill: give every existing auth user their own organization + profile,
-- and re-home their races onto that organization.
-- ============================================================================
do $$
declare
  -- CHANGE THIS to move the super_admin grant to a different account.
  super_admin_email constant text := 'nicolasarias870@gmail.com';
  u record;
  new_org_id uuid;
  org_name text;
  user_role_value user_role;
begin
  for u in select id, email, raw_user_meta_data from auth.users loop
    -- Derive a friendly org name from the user's display name or email local-part.
    org_name := 'Organización - ' || coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      split_part(u.email, '@', 1)
    );

    insert into organizations (name)
    values (org_name)
    returning id into new_org_id;

    if u.email = super_admin_email then
      user_role_value := 'super_admin';
    else
      user_role_value := 'admin';
    end if;

    insert into profiles (id, organization_id, role)
    values (u.id, new_org_id, user_role_value);

    update races
    set organization_id = new_org_id
    where organizer_id = u.id;
  end loop;
end;
$$;

-- Every race had a NOT NULL organizer_id, so all rows are now populated.
alter table races
  alter column organization_id set not null;

-- ============================================================================
-- handle_new_user trigger
-- ----------------------------------------------------------------------------
-- Runs AFTER INSERT on auth.users so the membership invariant ("every user has
-- exactly one org + role") holds for both invited users and self-signups.
--
--  - Invited user: Supabase `inviteUserByEmail` creates the auth.users row with
--    organization_id (and optional role) in raw_user_meta_data. We attach the
--    profile to that organization immediately, at invite time.
--  - Self-signup organizer: no organization_id in metadata, so we create a fresh
--    organization and make them its admin.
--
-- SECURITY DEFINER so the trigger can write to organizations/profiles regardless
-- of the inserting role.
-- ============================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  org_name text;
begin
  if new.raw_user_meta_data ? 'organization_id' then
    -- Invited user: join the inviting organization with the assigned role.
    insert into profiles (id, organization_id, role)
    values (
      new.id,
      (new.raw_user_meta_data ->> 'organization_id')::uuid,
      coalesce(new.raw_user_meta_data ->> 'role', 'operator')::user_role
    );
  else
    -- Brand-new self-signup organizer: spin up their own organization.
    org_name := 'Organización - ' || coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    );

    insert into organizations (name)
    values (org_name)
    returning id into new_org_id;

    insert into profiles (id, organization_id, role)
    values (new.id, new_org_id, 'admin');
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

-- ============================================================================
-- Indexes
-- ============================================================================
create index idx_profiles_organization_id on profiles(organization_id);
create index idx_races_organization_id on races(organization_id);

-- Podio — public contact / lead submissions (marketing landing page)
--
-- The public landing page (app/page.tsx) has a contact form race organizers use
-- to request information. Submissions are stored here for the site owner to
-- review manually — there is no automated processing or notification.
-- Consistent with the rest of the schema, RLS is INTENTIONALLY NOT ENABLED: the
-- public form POSTs to app/api/contact, which inserts with the service-role
-- client (lib/supabase/admin.ts). The anon key never writes here directly.
create table contact_submissions (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  name         text not null,
  email        text not null,
  organization text,
  phone        text,
  message      text not null,
  -- flipped by the owner while reviewing leads; defaults to unhandled
  handled      boolean not null default false
);

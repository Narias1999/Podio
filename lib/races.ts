import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared "load race for caller's organization" helper (Stories 04/05). Looks up
 * a race by slug and confirms it belongs to the caller's organization before
 * any read or write proceeds (no RLS — Story 01 authorization model). All
 * members of an organization can access/manage its races, so authorization is
 * by `organization_id`, not the legacy per-user `organizer_id`. Returns `null`
 * when the race doesn't exist or belongs to another organization, which callers
 * map to a 404 so as not to leak whether a slug exists.
 *
 * Always selects `id, organization_id`; callers that need extra columns for
 * their route (e.g. `is_multi_stage`) read them with a follow-up query keyed
 * by the returned `id`, or inline their own `.select(...)` + org check when a
 * single round trip matters. This keeps the helper's return type simple and
 * stable instead of fighting Supabase's literal-select inference with a generic
 * column-string parameter (which blows up type-checking).
 */
export async function loadOwnedRace(
  admin: ReturnType<typeof createAdminClient>,
  slug: string,
  organizationId: string,
) {
  const { data: race } = await admin
    .from("races")
    .select("id, organization_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organization_id !== organizationId) {
    return null;
  }
  return race;
}

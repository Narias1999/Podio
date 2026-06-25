import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared "load owned race by slug" helper (Stories 04/05). Looks up a race by
 * slug and confirms `organizer_id` matches the session user before any read
 * or write proceeds (no RLS — Story 01 authorization model). Returns `null`
 * when the race doesn't exist or isn't owned by the user, which callers map
 * to a 404 so as not to leak whether a slug exists.
 *
 * Always selects `id, organizer_id`; callers that need extra columns for
 * their route (e.g. `is_multi_stage`) read them with a follow-up query keyed
 * by the returned `id`, or inline their own `.select(...)` + ownership check
 * when a single round trip matters. This keeps the helper's return type
 * simple and stable instead of fighting Supabase's literal-select inference
 * with a generic column-string parameter (which blows up type-checking).
 */
export async function loadOwnedRace(
  admin: ReturnType<typeof createAdminClient>,
  slug: string,
  userId: string,
) {
  const { data: race } = await admin
    .from("races")
    .select("id, organizer_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organizer_id !== userId) {
    return null;
  }
  return race;
}

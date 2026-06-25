// Server-only helpers for resolving the current authenticated organizer.
// Reused by route handlers and server components in later stories to identify
// the session user before scoping reads/writes to `races.organizer_id`.
import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Returns the currently authenticated Supabase user, or `null` if there is
 * no active session. Safe to call from server components and route handlers.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

/**
 * Returns the currently authenticated Supabase user, redirecting to
 * `/login` if there is no active session. Use in server components / route
 * handlers that require an organizer to be signed in.
 */
export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

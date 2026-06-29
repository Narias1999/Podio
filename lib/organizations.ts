// Server-only helpers for resolving the current user's organization membership
// and role, plus role-based capability predicates. RLS is off — profiles are
// read with the service-role admin client AFTER authenticating the session.
import "server-only";

import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/app";

export type CurrentProfile = {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  organization_id: string;
  role: UserRole;
};

/**
 * Returns the authenticated user together with their organization id and role,
 * or `null` if there is no session or no profile row. Every authenticated user
 * is expected to have exactly one profile (created by the handle_new_user
 * trigger), so a missing profile is an unexpected state.
 */
export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return null;
  }

  return {
    user,
    organization_id: profile.organization_id,
    role: profile.role,
  };
}

/**
 * Like `getCurrentProfile` but redirects to `/login` when there is no session
 * or no profile. Use in server components / route handlers that require an
 * organization member.
 */
export async function requireProfile(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  return profile;
}

/**
 * Resolves a user's organization id with the service-role admin client. Used by
 * route handlers that have already authenticated the session and need the
 * caller's organization to authorize a race access (via `loadOwnedRace`).
 * Returns `null` when the user has no profile (unexpected — every user should
 * have one via the handle_new_user trigger).
 */
export async function getOrganizationId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .maybeSingle();

  return profile?.organization_id ?? null;
}

// Role capability predicates (cumulative ladder).
export function canManageRaces(role: UserRole): boolean {
  return role === "operator" || role === "admin" || role === "super_admin";
}

export function canInviteUsers(role: UserRole): boolean {
  return role === "admin" || role === "super_admin";
}

export function canCreateOrganization(role: UserRole): boolean {
  return role === "super_admin";
}

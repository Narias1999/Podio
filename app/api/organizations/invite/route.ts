import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile, canInviteUsers } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/app";

// POST /api/organizations/invite — invites a user (admin or operator) into the
// caller's own organization by email. admin|super_admin only. RLS is off — the
// session is authenticated, the role is checked, and the 5-user cap enforced
// before writing with the service-role client.
//
// Body: { email: string, role: 'admin' | 'operator' }
//
// The invitee receives a Supabase email invite carrying the caller's
// organization_id + the chosen role in their metadata; the handle_new_user
// trigger creates their profile at invite time. The link routes through
// /auth/callback?next=/auth/reset-password.
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!canInviteUsers(profile.role)) {
    return NextResponse.json(
      { error: "No tienes permiso para invitar usuarios." },
      { status: 403 },
    );
  }

  let body: { email?: unknown; role?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = body.role as UserRole;

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Ingresa un correo válido." },
      { status: 400 },
    );
  }
  if (role !== "admin" && role !== "operator") {
    return NextResponse.json(
      { error: "Rol no válido." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Enforce the per-organization user cap (default 5).
  const { data: org } = await admin
    .from("organizations")
    .select("max_users")
    .eq("id", profile.organization_id)
    .maybeSingle();

  const maxUsers = org?.max_users ?? 5;

  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", profile.organization_id);

  if ((count ?? 0) >= maxUsers) {
    return NextResponse.json(
      {
        error: `Tu organización ya alcanzó el máximo de ${maxUsers} usuarios.`,
      },
      { status: 409 },
    );
  }

  // Reject if the email already belongs to an account (any organization).
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existing = existingUsers?.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe una cuenta con ese correo." },
      { status: 409 },
    );
  }

  const origin = request.nextUrl.origin;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: { organization_id: profile.organization_id, role },
      redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
    },
  );

  if (inviteError) {
    return NextResponse.json(
      { error: "No se pudo enviar la invitación. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

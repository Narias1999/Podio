import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile, canCreateOrganization } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/organizations — creates a new organization and invites its first
// admin by email. super_admin only. RLS is off — the session is authenticated
// and the caller's role is checked before writing with the service-role client.
//
// Body: { name: string, adminEmail: string }
//
// The invited admin receives a Supabase email invite carrying the new
// organization_id + role 'admin' in their user metadata; the handle_new_user
// trigger creates their profile at invite time. The invite link routes through
// /auth/callback?next=/auth/reset-password so they set a password and land in.
export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  if (!canCreateOrganization(profile.role)) {
    return NextResponse.json(
      { error: "No tienes permiso para crear organizaciones." },
      { status: 403 },
    );
  }

  let body: { name?: unknown; adminEmail?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const adminEmail =
    typeof body.adminEmail === "string" ? body.adminEmail.trim() : "";

  if (!name) {
    return NextResponse.json(
      { error: "El nombre de la organización es obligatorio." },
      { status: 400 },
    );
  }
  if (!adminEmail || !adminEmail.includes("@")) {
    return NextResponse.json(
      { error: "Ingresa un correo válido para el administrador." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Reject if the email already has a profile (already belongs to an org).
  const { data: existingUsers } = await admin.auth.admin.listUsers();
  const existing = existingUsers?.users.find(
    (u) => u.email?.toLowerCase() === adminEmail.toLowerCase(),
  );
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe una cuenta con ese correo." },
      { status: 409 },
    );
  }

  // Create the organization first so we can attach the invited admin to it.
  const { data: organization, error: orgError } = await admin
    .from("organizations")
    .insert({ name })
    .select("id")
    .single();

  if (orgError || !organization) {
    return NextResponse.json(
      { error: "No se pudo crear la organización. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const origin = request.nextUrl.origin;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    adminEmail,
    {
      data: { organization_id: organization.id, role: "admin" },
      redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
    },
  );

  if (inviteError) {
    // Roll back the organization so we don't leave an empty org with no admin.
    await admin.from("organizations").delete().eq("id", organization.id);
    return NextResponse.json(
      { error: "No se pudo enviar la invitación. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { organizationId: organization.id },
    { status: 201 },
  );
}

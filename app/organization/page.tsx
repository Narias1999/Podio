import type { Metadata } from "next";
import Link from "next/link";

import {
  requireProfile,
  canInviteUsers,
  canCreateOrganization,
} from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InviteUserForm } from "@/components/invite-user-form";
import { CreateOrganizationForm } from "@/components/create-organization-form";
import type { UserRole } from "@/types/app";

export const metadata: Metadata = {
  title: "Organización — Podio",
  description: "Gestiona los miembros de tu organización en Podio.",
};

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super administrador",
  admin: "Administrador",
  operator: "Operador",
};

export default async function OrganizationPage() {
  const { organization_id, role } = await requireProfile();

  const admin = createAdminClient();

  const { data: organization } = await admin
    .from("organizations")
    .select("name, max_users")
    .eq("id", organization_id)
    .maybeSingle();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, role, created_at")
    .eq("organization_id", organization_id)
    .order("created_at", { ascending: true });

  const memberProfiles = profiles ?? [];

  // Resolve member emails via the admin auth API (service-role, server-only).
  const { data: usersData } = await admin.auth.admin.listUsers();
  const emailById = new Map(
    (usersData?.users ?? []).map((u) => [u.id, u.email ?? "—"]),
  );

  const members = memberProfiles.map((profile) => ({
    id: profile.id,
    email: emailById.get(profile.id) ?? "—",
    role: profile.role as UserRole,
  }));

  const maxUsers = organization?.max_users ?? 5;
  const memberCount = members.length;
  const atCapacity = memberCount >= maxUsers;

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-medium">Podio</h1>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Volver al panel</Link>
        </Button>
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:py-10">
        <div>
          <h2 className="text-2xl font-semibold">
            {organization?.name ?? "Tu organización"}
          </h2>
          <p className="text-muted-foreground">
            {memberCount} / {maxUsers} usuarios
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Miembros</CardTitle>
            <CardDescription>
              Todos los miembros pueden crear y gestionar las carreras de la
              organización.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Correo electrónico</TableHead>
                  <TableHead>Rol</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {ROLE_LABELS[member.role]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {canInviteUsers(role) && (
          <Card>
            <CardHeader>
              <CardTitle>Invitar usuario</CardTitle>
              <CardDescription>
                Envía una invitación por correo para que un nuevo usuario se una
                a tu organización.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {atCapacity && (
                <p className="text-sm text-muted-foreground" role="status">
                  Tu organización alcanzó el máximo de {maxUsers} usuarios. No
                  puedes invitar a nadie más.
                </p>
              )}
              <InviteUserForm disabled={atCapacity} />
            </CardContent>
          </Card>
        )}

        {canCreateOrganization(role) && (
          <Card>
            <CardHeader>
              <CardTitle>Crear organización</CardTitle>
              <CardDescription>
                Crea una nueva organización e invita a su administrador.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateOrganizationForm />
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}

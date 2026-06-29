"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Creates a new organization and invites its first admin. super_admin only.
// Posts to /api/organizations and surfaces success/error via toasts.
export function CreateOrganizationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, adminEmail }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        toast.error(data.error ?? "No se pudo crear la organización.");
        return;
      }

      toast.success("Organización creada e invitación enviada.");
      setName("");
      setAdminEmail("");
      router.refresh();
    } catch {
      toast.error("No se pudo crear la organización. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="org-name">Nombre de la organización</Label>
        <Input
          id="org-name"
          type="text"
          placeholder="Liga de Ciclismo"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="org-admin-email">Correo del administrador</Label>
        <Input
          id="org-admin-email"
          type="email"
          autoComplete="off"
          placeholder="admin@correo.com"
          value={adminEmail}
          onChange={(event) => setAdminEmail(event.target.value)}
          disabled={pending}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creando..." : "Crear organización"}
      </Button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InviteRole = "admin" | "operator";

// Invites a user into the caller's organization. Posts to
// /api/organizations/invite and surfaces success/error via toasts.
export function InviteUserForm({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("operator");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/organizations/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        toast.error(data.error ?? "No se pudo enviar la invitación.");
        return;
      }

      toast.success("Invitación enviada.");
      setEmail("");
      setRole("operator");
      router.refresh();
    } catch {
      toast.error("No se pudo enviar la invitación. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-email">Correo electrónico</Label>
        <Input
          id="invite-email"
          type="email"
          autoComplete="off"
          placeholder="usuario@correo.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={disabled || pending}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-role">Rol</Label>
        <Select
          value={role}
          onValueChange={(value) => setRole(value as InviteRole)}
          disabled={disabled || pending}
        >
          <SelectTrigger id="invite-role">
            <SelectValue placeholder="Selecciona un rol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="operator">Operador</SelectItem>
            <SelectItem value="admin">Administrador</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={disabled || pending}>
        {pending ? "Enviando..." : "Invitar usuario"}
      </Button>
    </form>
  );
}

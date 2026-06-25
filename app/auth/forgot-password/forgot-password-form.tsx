"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestPasswordReset,
  type ResetRequestState,
} from "@/app/login/actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<
    ResetRequestState,
    FormData
  >(requestPasswordReset, undefined);

  if (state?.sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Si existe una cuenta con ese correo, te enviamos un enlace para
          restablecer tu contraseña. Revisa tu bandeja de entrada.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Volver a iniciar sesión</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="organizador@correo.com"
          required
        />
      </div>
      {state?.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Enviando..." : "Enviar enlace"}
      </Button>
      <Button asChild variant="link" className="w-full">
        <Link href="/login">Volver a iniciar sesión</Link>
      </Button>
    </form>
  );
}

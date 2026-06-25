import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ForgotPasswordForm } from "@/app/auth/forgot-password/forgot-password-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña — Podio",
  description: "Te enviamos un enlace para restablecer tu contraseña.",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Recuperar contraseña</CardTitle>
          <CardDescription>
            Ingresa tu correo y te enviaremos un enlace para crear una nueva
            contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}

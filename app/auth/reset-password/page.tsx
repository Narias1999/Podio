import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ResetPasswordForm } from "@/app/auth/reset-password/reset-password-form";

export const metadata: Metadata = {
  title: "Nueva contraseña — Podio",
  description: "Crea una nueva contraseña para tu cuenta de organizador.",
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Nueva contraseña</CardTitle>
          <CardDescription>
            Ingresa la nueva contraseña para tu cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}

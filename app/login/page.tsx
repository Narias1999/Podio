import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "@/app/login/login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión — Podio",
  description: "Inicia sesión para gestionar tus carreras en Podio.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Iniciar sesión</CardTitle>
          <CardDescription>
            Ingresa con tu correo y contraseña de organizador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm oauthError={error === "auth"} />
        </CardContent>
      </Card>
    </main>
  );
}

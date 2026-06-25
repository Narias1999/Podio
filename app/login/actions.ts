"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  error?: string;
} | undefined;

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Correo o contraseña incorrectos. Inténtalo de nuevo." };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: "Correo o contraseña incorrectos. Inténtalo de nuevo." };
  }

  redirect("/dashboard");
}

export type ResetRequestState = {
  error?: string;
  sent?: boolean;
} | undefined;

export async function requestPasswordReset(
  _prevState: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "");

  if (!email) {
    return { error: "Ingresa tu correo electrónico." };
  }

  const supabase = await createClient();

  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ?? `https://${headerStore.get("host")}`;

  // The recovery email links to /auth/callback, which exchanges the code for a
  // session and forwards the organizer to the reset-password form.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  });

  // Always report success so we don't reveal whether an account exists.
  return { sent: true };
}

export type ResetPasswordState = {
  error?: string;
} | undefined;

export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "La contraseña debe tener al menos 8 caracteres." };
  }

  if (password !== confirm) {
    return { error: "Las contraseñas no coinciden." };
  }

  const supabase = await createClient();

  // The recovery session was established by /auth/callback before reaching here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error:
        "El enlace de recuperación no es válido o expiró. Solicita uno nuevo.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: "No pudimos actualizar la contraseña. Inténtalo de nuevo." };
  }

  redirect("/dashboard");
}

export async function loginWithGoogle() {
  const supabase = await createClient();

  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ?? `https://${headerStore.get("host")}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error || !data.url) {
    redirect("/login?error=auth");
  }

  redirect(data.url);
}

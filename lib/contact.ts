// Shared types + validation for the public landing-page contact form.
// Used by the client form (components/landing/contact-form.tsx) and the
// public write endpoint (app/api/contact/route.ts). Keep the rules in sync.

export type ContactPayload = {
  name: string;
  email: string;
  organization?: string | null;
  phone?: string | null;
  message: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_LEN = {
  name: 120,
  email: 160,
  organization: 160,
  phone: 40,
  message: 2000,
} as const;

/**
 * Returns a Spanish error message if the payload is invalid, or null if it is
 * valid. Mirrors the constraints enforced by the API route so the form can give
 * immediate feedback without a round trip.
 */
export function validateContactPayload(payload: ContactPayload): string | null {
  if (!payload || typeof payload !== "object") {
    return "Solicitud no válida.";
  }

  const name = payload.name?.trim() ?? "";
  if (name.length < 2) {
    return "Ingresa tu nombre.";
  }
  if (name.length > MAX_LEN.name) {
    return "El nombre es demasiado largo.";
  }

  const email = payload.email?.trim() ?? "";
  if (!EMAIL_REGEX.test(email) || email.length > MAX_LEN.email) {
    return "Ingresa un correo electrónico válido.";
  }

  const message = payload.message?.trim() ?? "";
  if (message.length < 10) {
    return "Cuéntanos un poco más sobre tu carrera (mínimo 10 caracteres).";
  }
  if (message.length > MAX_LEN.message) {
    return "El mensaje es demasiado largo.";
  }

  if ((payload.organization?.trim().length ?? 0) > MAX_LEN.organization) {
    return "El nombre de la organización es demasiado largo.";
  }

  if ((payload.phone?.trim().length ?? 0) > MAX_LEN.phone) {
    return "El teléfono es demasiado largo.";
  }

  return null;
}

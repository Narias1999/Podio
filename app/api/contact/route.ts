import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { type ContactPayload, validateContactPayload } from "@/lib/contact";

// POST /api/contact — stores a public landing-page contact submission for the
// site owner to review manually. This endpoint is intentionally PUBLIC (no
// session): anyone visiting the marketing page can submit. There is no RLS, so
// the write goes through the service-role admin client after validation. The
// submission is inert data (name/email/message) reviewed by hand — it grants no
// access and triggers no automated action.
export async function POST(request: Request) {
  let payload: ContactPayload;
  try {
    payload = (await request.json()) as ContactPayload;
  } catch {
    return NextResponse.json(
      { error: "Solicitud no válida." },
      { status: 400 },
    );
  }

  const validationError = validateContactPayload(payload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const admin = createAdminClient();

  const { error } = await admin.from("contact_submissions").insert({
    name: payload.name.trim(),
    email: payload.email.trim(),
    organization: payload.organization?.trim() || null,
    phone: payload.phone?.trim() || null,
    message: payload.message.trim(),
  });

  if (error) {
    return NextResponse.json(
      { error: "No se pudo enviar tu mensaje. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

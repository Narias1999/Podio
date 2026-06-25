"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type ContactPayload, validateContactPayload } from "@/lib/contact";

const EMPTY: ContactPayload = {
  name: "",
  email: "",
  organization: "",
  phone: "",
  message: "",
};

export function ContactForm() {
  const [values, setValues] = useState<ContactPayload>(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof ContactPayload>(
    key: K,
    value: ContactPayload[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const validationError = validateContactPayload(values);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(
          data?.error ?? "No se pudo enviar tu mensaje. Inténtalo de nuevo.",
        );
        return;
      }

      toast.success("¡Mensaje enviado! Te contactaremos muy pronto.");
      setValues(EMPTY);
    } catch {
      toast.error(
        "No se pudo enviar tu mensaje. Revisa tu conexión e inténtalo de nuevo.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-name">Nombre *</Label>
          <Input
            id="contact-name"
            name="name"
            autoComplete="name"
            placeholder="Tu nombre"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            disabled={submitting}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-email">Correo electrónico *</Label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            disabled={submitting}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-organization">Organización o carrera</Label>
          <Input
            id="contact-organization"
            name="organization"
            placeholder="Nombre de tu evento (opcional)"
            value={values.organization ?? ""}
            onChange={(e) => update("organization", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-phone">Teléfono</Label>
          <Input
            id="contact-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Opcional"
            value={values.phone ?? ""}
            onChange={(e) => update("phone", e.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-message">Mensaje *</Label>
        <Textarea
          id="contact-message"
          name="message"
          rows={4}
          placeholder="Cuéntanos sobre tu carrera: disciplina, número de etapas y cuántos corredores esperas."
          value={values.message}
          onChange={(e) => update("message", e.target.value)}
          disabled={submitting}
          required
        />
      </div>

      <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto">
        {submitting ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Send aria-hidden />
        )}
        {submitting ? "Enviando…" : "Enviar mensaje"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Revisamos cada solicitud personalmente. Tus datos solo se usan para
        contactarte sobre Podio.
      </p>
    </form>
  );
}

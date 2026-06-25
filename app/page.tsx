import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Flag,
  Gauge,
  ListOrdered,
  Radio,
  Smartphone,
  Timer,
  Trophy,
  Users,
  WifiOff,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { ContactForm } from "@/components/landing/contact-form";
import { WhatsappButton } from "@/components/landing/whatsapp-button";

export const metadata: Metadata = {
  title: "Podio — Cronometraje y resultados en vivo para tus carreras",
  description:
    "Podio es la plataforma para organizar carreras de ciclismo y running: cronometraje en vivo, clasificación general automática y resultados públicos en tiempo real.",
};

const features = [
  {
    icon: Timer,
    title: "Cronometraje en vivo",
    description:
      "Pantallas de salida y meta para contrarreloj y ruta. Un toque captura el tiempo de cada corredor, incluso con varios llegando juntos.",
  },
  {
    icon: Trophy,
    title: "Clasificación general automática",
    description:
      "La GC se calcula sola sumando los tiempos de cada etapa. Sin hojas de cálculo ni cuentas manuales.",
  },
  {
    icon: Radio,
    title: "Resultados públicos en tiempo real",
    description:
      "Cada tiempo guardado aparece al instante en la página pública. Espectadores y corredores siguen la carrera sin que publiques nada.",
  },
  {
    icon: WifiOff,
    title: "Funciona sin conexión",
    description:
      "Los datos se guardan en el dispositivo y se sincronizan solos cuando vuelve la señal. Nada se pierde en zonas sin cobertura.",
  },
  {
    icon: Users,
    title: "Inscripciones y categorías",
    description:
      "Registra corredores uno a uno o importa cientos desde un archivo. Las categorías se asignan automáticamente por edad y sexo.",
  },
  {
    icon: ListOrdered,
    title: "Orden de salida inteligente",
    description:
      "Genera el orden de salida de las contrarrelojes (aleatorio o por GC inversa) y ajústalo manualmente cuando lo necesites.",
  },
];

const benefits = [
  {
    icon: Gauge,
    title: "Ahorra horas de trabajo",
    description:
      "Olvídate de cronómetros, planillas y digitar tiempos a mano. Todo el flujo —de la inscripción a la clasificación— vive en un solo lugar.",
  },
  {
    icon: Smartphone,
    title: "Pensado para el día de la carrera",
    description:
      "Pantallas grandes y táctiles para operar bajo presión, con un indicador permanente que te avisa si hay datos pendientes por enviar.",
  },
  {
    icon: Flag,
    title: "Una experiencia profesional",
    description:
      "Ofrece a tus corredores y patrocinadores resultados públicos en vivo con la imagen de un evento serio y bien organizado.",
  },
];

const steps = [
  {
    number: "1",
    title: "Crea tu carrera",
    description:
      "Configura disciplina, etapas y categorías en minutos. Inscribe a los corredores manualmente o por importación masiva.",
  },
  {
    number: "2",
    title: "Cronometra en vivo",
    description:
      "El día del evento, el operador de meta captura cada tiempo con un toque. Los datos se guardan aunque falle la conexión.",
  },
  {
    number: "3",
    title: "Publica los resultados",
    description:
      "La clasificación por etapa y la general se actualizan solas en la página pública, en tiempo real y sin pasos extra.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Trophy className="size-4" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight">Podio</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a
              href="#funciones"
              className="transition-colors hover:text-foreground"
            >
              Funciones
            </a>
            <a
              href="#como-funciona"
              className="transition-colors hover:text-foreground"
            >
              Cómo funciona
            </a>
            <a
              href="#contacto"
              className="transition-colors hover:text-foreground"
            >
              Contacto
            </a>
          </nav>
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Iniciar sesión
          </Link>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_82%),transparent)]"
            aria-hidden
          />
          <div className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Radio className="size-3.5 text-primary" aria-hidden />
              Cronometraje y resultados en vivo
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-6xl">
              La forma moderna de cronometrar tus carreras
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
              Podio reúne inscripciones, cronometraje en vivo, clasificación
              general automática y resultados públicos en tiempo real para
              carreras de ciclismo y running. Todo en una sola plataforma.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a href="#contacto" className={buttonVariants({ size: "lg" })}>
                Solicitar una demo
                <ArrowRight aria-hidden />
              </a>
              <WhatsappButton variant="outline" />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Hecho para organizadores en Colombia 🇨🇴
            </p>
          </div>
        </section>

        {/* Features */}
        <section
          id="funciones"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
        >
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Todo lo que necesitas el día de la carrera
            </h2>
            <p className="mt-4 text-muted-foreground">
              Una herramienta diseñada con organizadores, para organizadores.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <feature.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Benefits */}
        <section className="border-y border-border bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                ¿Qué ganas con Podio?
              </h2>
              <p className="mt-4 text-muted-foreground">
                Menos estrés operativo, más tiempo para lo que importa: tu
                evento y tus corredores.
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {benefits.map((benefit) => (
                <div
                  key={benefit.title}
                  className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <benefit.icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="text-lg font-semibold">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {benefit.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="como-funciona"
          className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24"
        >
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Cómo funciona
            </h2>
            <p className="mt-4 text-muted-foreground">
              De la inscripción a la clasificación general en tres pasos.
            </p>
          </div>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="relative">
                <span className="flex size-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                  {step.number}
                </span>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section
          id="contacto"
          className="scroll-mt-20 border-t border-border bg-muted/40"
        >
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
            <div className="flex flex-col justify-center">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Hablemos de tu próxima carrera
              </h2>
              <p className="mt-4 text-muted-foreground">
                Déjanos tus datos y te contactaremos para mostrarte cómo Podio
                puede ayudarte a organizar tu evento. ¿Prefieres una respuesta
                inmediata? Escríbenos directamente por WhatsApp.
              </p>
              <div className="mt-6">
                <WhatsappButton />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                +57 322 249 7943
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
              <ContactForm />
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Trophy className="size-3.5" aria-hidden />
            </span>
            <span className="font-semibold text-foreground">Podio</span>
          </div>
          <p>© 2026 Podio. Cronometraje y resultados para carreras.</p>
        </div>
      </footer>
    </div>
  );
}

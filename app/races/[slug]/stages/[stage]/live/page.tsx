import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Flag, Timer } from "lucide-react";

import { requireProfile } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "En vivo — Podio",
};

/**
 * Live hub for a stage — the intuitive entry point to the two day-of operator
 * screens (start line + finish line). Each screen runs on a different device, so
 * this page lets the operator pick which one they are. It routes to the correct
 * TT or group variant based on `stage_type`. Organizer-only: `/live` is auth
 * gated in `lib/supabase/middleware.ts` and we re-check the caller's
 * organization here (RLS is off — Story 01 authorization model).
 */
export default async function StageLiveHubPage({
  params,
}: {
  params: Promise<{ slug: string; stage: string }>;
}) {
  const { slug, stage: stageParam } = await params;
  const stageNumber = Number.parseInt(stageParam, 10);
  const { organization_id } = await requireProfile();

  if (!Number.isInteger(stageNumber)) {
    notFound();
  }

  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("id, name, organization_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organization_id !== organization_id) {
    notFound();
  }

  const { data: stage } = await admin
    .from("stages")
    .select("id, name, stage_type")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  if (!stage) {
    notFound();
  }

  const isTt = stage.stage_type === "time_trial";
  const base = `/races/${slug}/stages/${stageNumber}/live/${isTt ? "tt" : "group"}`;

  const startDescription = isTt
    ? "Cuenta regresiva que avisa cuándo sale cada corredor. Ábrela en la línea de partida."
    : "Selecciona las categorías que salen juntas y da la largada. Ábrela en la línea de partida.";
  const finishDescription = isTt
    ? "Toca STOP en cada llegada y asigna el dorsal. Ábrela en la meta."
    : "Toca STOP por cada grupo que llega y registra sus dorsales. Ábrela en la meta.";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-4 md:py-10">
      <Button asChild variant="outline" className="self-start">
        <Link href={`/races/${slug}/manage`}>← Volver</Link>
      </Button>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{stage.name}</h1>
        <p className="text-muted-foreground">
          Elige la pantalla para este dispositivo. Abre la de salida en la
          partida y la de meta en la llegada.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href={`${base}/start`}
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Card className="h-full transition-colors hover:border-primary hover:bg-accent">
            <CardHeader>
              <div className="mb-2 flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Flag className="size-6" />
                </span>
                <CardTitle className="text-xl">Pantalla de salida</CardTitle>
              </div>
              <CardDescription className="text-base">
                {startDescription}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link
          href={`${base}/finish`}
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Card className="h-full transition-colors hover:border-primary hover:bg-accent">
            <CardHeader>
              <div className="mb-2 flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Timer className="size-6" />
                </span>
                <CardTitle className="text-xl">Pantalla de meta</CardTitle>
              </div>
              <CardDescription className="text-base">
                {finishDescription}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </main>
  );
}

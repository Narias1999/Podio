import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { requireProfile } from "@/lib/organizations";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  StartOrderManager,
  type StartOrderRow,
} from "@/components/start-order-manager";
import { isStartOrderLocked, loadStartOrder } from "@/lib/tt-start-order";

export const metadata: Metadata = {
  title: "Orden de salida — Podio",
};

export default async function StartOrderPage({
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

  // Organizer read scoped to the caller's organization. Service-role client +
  // explicit organization_id check (RLS is off — Story 01 authorization model).
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("id, name, organization_id, registrations_closed")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organization_id !== organization_id) {
    notFound();
  }

  const { data: stage } = await admin
    .from("stages")
    .select("*")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  if (!stage) {
    notFound();
  }

  // The start-order screen only applies to time trials.
  if (stage.stage_type !== "time_trial") {
    notFound();
  }

  const entries = await loadStartOrder(admin, stage.id);
  const rows: StartOrderRow[] = entries.map((e) => ({
    registration_id: e.registration_id,
    position: e.position,
    start_time: e.start_time,
    bib_number: e.bib_number,
    rider_name: e.rider_name,
    team: e.team,
    category_id: e.category_id,
    category_name: e.category_name,
  }));
  const locked = await isStartOrderLocked(admin, stage.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 md:py-10">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline">
          <Link href={`/races/${slug}/manage`}>← Gestionar carrera</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Orden de salida — {stage.name}</h1>
        <p className="text-muted-foreground">{race.name}</p>
      </div>

      {!race.registrations_closed ? (
        <Card>
          <CardHeader>
            <CardTitle>Inscripción abierta</CardTitle>
            <CardDescription>
              Para generar el orden de salida primero debes cerrar la
              inscripción y asignar los dorsales.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/races/${slug}/manage/riders`}>
                Ir a corredores
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <StartOrderManager
          slug={slug}
          stageNumber={stageNumber}
          initialRows={rows}
          locked={locked}
        />
      )}
    </main>
  );
}

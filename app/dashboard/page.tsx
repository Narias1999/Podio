import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Plus } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DISCIPLINE_LABELS, RACE_STATUS_LABELS } from "@/lib/race-status";
import type { Discipline, RaceStatus } from "@/types/app";
import { SignOutButton } from "@/app/dashboard/sign-out-button";

export const metadata: Metadata = {
  title: "Panel — Podio",
  description: "Panel de organizador de Podio.",
};

function formatRaceDates(startsAt: string, endsAt: string | null): string {
  const start = format(new Date(`${startsAt}T00:00:00`), "PPP", { locale: es });
  if (!endsAt || endsAt === startsAt) return start;
  const end = format(new Date(`${endsAt}T00:00:00`), "PPP", { locale: es });
  return `${start} – ${end}`;
}

export default async function DashboardPage() {
  const user = await requireUser();

  // Organizer read scoped to the session user (RLS off — Story 01 model).
  const admin = createAdminClient();
  const { data: races } = await admin
    .from("races")
    .select("id, name, slug, discipline, status, starts_at, ends_at")
    .eq("organizer_id", user.id)
    .order("starts_at", { ascending: false });

  const raceList = races ?? [];

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b p-4">
        <h1 className="text-lg font-medium">Podio</h1>
        <SignOutButton />
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:py-10">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">Tus carreras</h2>
          <Button asChild>
            <Link href="/races/new">
              <Plus className="size-4" />
              Crear nueva carrera
            </Link>
          </Button>
        </div>

        {raceList.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
            <p className="text-muted-foreground">
              Aún no has creado ninguna carrera.
            </p>
            <Button asChild variant="outline">
              <Link href="/races/new">
                <Plus className="size-4" />
                Crear tu primera carrera
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {raceList.map((race) => {
              const status = race.status as RaceStatus;
              const discipline = race.discipline as Discipline;
              return (
                <Link key={race.id} href={`/races/${race.slug}/manage`}>
                  <Card className="h-full transition-colors hover:bg-muted/40">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-lg">{race.name}</CardTitle>
                        <Badge
                          variant={
                            status === "published" ? "default" : "secondary"
                          }
                        >
                          {RACE_STATUS_LABELS[status]}
                        </Badge>
                      </div>
                      <CardDescription>
                        {formatRaceDates(race.starts_at, race.ends_at)}
                        {" · "}
                        {DISCIPLINE_LABELS[discipline]}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

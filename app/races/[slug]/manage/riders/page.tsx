import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { RidersManager, type RiderRow } from "@/components/riders-manager";
import type { Category, Sex } from "@/types/app";

export const metadata: Metadata = {
  title: "Corredores — Podio",
};

export default async function ManageRidersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();

  // Organizer read scoped to the session user. Service-role client + explicit
  // organizer_id check (RLS is off — Story 01 authorization model).
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("id, name, organizer_id, starts_at, registrations_closed")
    .eq("slug", slug)
    .maybeSingle();

  if (!race || race.organizer_id !== user.id) {
    notFound();
  }

  const { data: categories } = await admin
    .from("categories")
    .select("*")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: true });

  const { data: registrations } = await admin
    .from("registrations")
    .select(
      "id, rider_id, category_id, bib_number, status, riders(id, document_number, name, nationality, team, sex, date_of_birth, eps, phone)",
    )
    .eq("race_id", race.id);

  const rows: RiderRow[] = (registrations ?? [])
    .filter((r) => r.riders)
    .map((r) => {
      const rider = r.riders as unknown as {
        id: string;
        document_number: string;
        name: string;
        nationality: string | null;
        team: string | null;
        sex: string;
        date_of_birth: string;
        eps: string | null;
        phone: string | null;
      };
      return {
        registration_id: r.id,
        rider_id: r.rider_id,
        category_id: r.category_id,
        bib_number: r.bib_number,
        status: r.status as "confirmed" | "dns",
        document_number: rider.document_number,
        name: rider.name,
        nationality: rider.nationality,
        team: rider.team,
        sex: rider.sex as Sex,
        date_of_birth: rider.date_of_birth,
        eps: rider.eps,
        phone: rider.phone,
      };
    });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-4 md:py-10">
      <div className="flex items-center justify-between">
        <Button asChild variant="outline">
          <Link href={`/races/${slug}/manage`}>← Gestionar carrera</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Corredores</h1>
        <p className="text-muted-foreground">{race.name}</p>
      </div>

      <RidersManager
        slug={slug}
        raceStartsAt={race.starts_at}
        registrationsClosed={race.registrations_closed}
        categories={(categories ?? []) as Category[]}
        initialRows={rows}
      />
    </main>
  );
}

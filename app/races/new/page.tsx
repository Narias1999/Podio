import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";
import { DEFAULT_CATEGORIES } from "@/lib/default-categories";
import { RaceWizard } from "@/app/races/new/race-wizard";

export const metadata: Metadata = {
  title: "Crear carrera — Podio",
  description: "Crea una nueva carrera paso a paso.",
};

export default async function NewRacePage() {
  // Protected route — redirects to /login if there is no session.
  await requireUser();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-4 md:py-10">
      <RaceWizard defaultCategories={DEFAULT_CATEGORIES} />
    </main>
  );
}

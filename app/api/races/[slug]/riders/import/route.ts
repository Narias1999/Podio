import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrganizationId } from "@/lib/organizations";
import { loadOwnedRace } from "@/lib/races";
import {
  createRiderRegistration,
  suggestCategoryFor,
  validateRiderRegistrationPayload,
  type RiderRegistrationPayload,
} from "@/lib/riders";
import type { Category, Sex } from "@/types/app";

// POST /api/races/[slug]/riders/import — bulk-registers riders from a parsed
// CSV (Story 07). The client sends already-parsed/normalized rows as JSON; the
// server re-validates every row, resolves each category (explicit name or
// auto-suggested from age + sex), and only then writes. The import is atomic:
// if any row fails to write, every rider/registration created in this request
// is rolled back so partial imports never reach the database (Story 07 rule).
// Authenticates the session, confirms the race belongs to the caller's
// organization, then writes with the service-role client (RLS is off — Story 01).

// One row as sent by the client (post-normalization, pre-write).
type ImportRow = {
  document_number: string;
  name: string;
  sex: Sex | null;
  date_of_birth: string;
  category: string; // raw category name from CSV (may be blank)
  team: string | null;
  nationality: string | null;
  eps: string | null;
  phone: string | null;
};

type ImportBody = { rows: ImportRow[] };

type RowError = { index: number; error: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug } = await params;
  const admin = createAdminClient();
  const organizationId = await getOrganizationId(admin, user.id);
  if (!organizationId) {
    return NextResponse.json({ error: "Carrera no encontrada." }, { status: 404 });
  }
  const race = await loadOwnedRace(admin, slug, organizationId);
  if (!race) {
    return NextResponse.json(
      { error: "Carrera no encontrada." },
      { status: 404 },
    );
  }

  // The race start date drives the age-based category auto-assignment.
  const { data: raceMeta, error: raceMetaError } = await admin
    .from("races")
    .select("starts_at")
    .eq("id", race.id)
    .single();

  if (raceMetaError || !raceMeta) {
    return NextResponse.json(
      { error: "No se pudo importar. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  let body: ImportBody;
  try {
    body = (await request.json()) as ImportBody;
  } catch {
    return NextResponse.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json(
      { error: "No hay filas para importar." },
      { status: 400 },
    );
  }

  const { data: categories, error: categoriesError } = await admin
    .from("categories")
    .select("*")
    .eq("race_id", race.id)
    .order("sort_order", { ascending: true });

  if (categoriesError) {
    return NextResponse.json(
      { error: "No se pudo importar. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const categoryList = (categories ?? []) as Category[];
  const categoryByName = new Map<string, Category>();
  for (const c of categoryList) categoryByName.set(c.name.toLowerCase(), c);
  const categoryIds = categoryList.map((c) => c.id);

  // Resolve each row to a full registration payload, re-running validation and
  // category resolution server-side (never trust the client's verdict). Build
  // payloads up front so a single bad row short-circuits before any write.
  const payloads: RiderRegistrationPayload[] = [];
  const rowErrors: RowError[] = [];
  const seenDocuments = new Set<string>();

  body.rows.forEach((row, index) => {
    const documentNumber = (row.document_number ?? "").trim();
    if (documentNumber && seenDocuments.has(documentNumber.toLowerCase())) {
      rowErrors.push({
        index,
        error: "Este documento aparece más de una vez en el archivo.",
      });
      return;
    }
    if (documentNumber) seenDocuments.add(documentNumber.toLowerCase());

    let categoryId: string | null = null;
    const rawCategory = (row.category ?? "").trim();
    if (rawCategory) {
      const match = categoryByName.get(rawCategory.toLowerCase());
      if (!match) {
        rowErrors.push({
          index,
          error: "La categoría no existe en esta carrera.",
        });
        return;
      }
      categoryId = match.id;
    } else if (
      (row.sex === "male" || row.sex === "female") &&
      row.date_of_birth
    ) {
      const suggestion = suggestCategoryFor(
        categoryList,
        { date_of_birth: row.date_of_birth, sex: row.sex },
        raceMeta.starts_at,
      );
      categoryId = suggestion?.id ?? null;
    }

    const payload: RiderRegistrationPayload = {
      document_number: documentNumber,
      name: (row.name ?? "").trim(),
      sex: row.sex,
      date_of_birth: row.date_of_birth,
      team: row.team,
      nationality: row.nationality,
      eps: row.eps,
      phone: row.phone,
      category_id: categoryId,
    };

    const validationError = validateRiderRegistrationPayload(
      payload,
      categoryIds,
    );
    if (validationError) {
      rowErrors.push({
        index,
        error:
          !categoryId && !rawCategory
            ? "No se pudo asignar una categoría automáticamente. Indícala en el archivo."
            : validationError,
      });
      return;
    }

    payloads.push(payload);
  });

  if (rowErrors.length > 0) {
    return NextResponse.json(
      {
        error: "Hay filas con errores. Corrige el archivo e inténtalo de nuevo.",
        rowErrors,
      },
      { status: 422 },
    );
  }

  // Atomic write: track what we create so we can roll back on any failure.
  // Supabase has no client-side transactions here, so we compensate manually.
  const createdRegistrationIds: string[] = [];
  const createdRiderIds: string[] = [];
  const summary = {
    imported: 0,
    reusedProfiles: 0,
    createdProfiles: 0,
    byCategory: {} as Record<string, number>,
  };

  for (const payload of payloads) {
    const result = await createRiderRegistration(admin, race.id, payload);
    if (!result.ok) {
      await rollback(admin, createdRegistrationIds, createdRiderIds);
      return NextResponse.json(
        {
          error:
            "No se pudo completar la importación. No se guardó ningún corredor. " +
            result.error,
        },
        { status: 409 },
      );
    }

    createdRegistrationIds.push(result.registration.id);
    if (result.reusedRider) {
      summary.reusedProfiles += 1;
    } else {
      summary.createdProfiles += 1;
      createdRiderIds.push(result.rider.id);
    }
    summary.imported += 1;

    const categoryName =
      categoryList.find((c) => c.id === payload.category_id)?.name ?? "—";
    summary.byCategory[categoryName] =
      (summary.byCategory[categoryName] ?? 0) + 1;
  }

  return NextResponse.json({ summary }, { status: 201 });
}

/**
 * Best-effort rollback of a failed bulk import: delete the registrations
 * created in this request, then the rider profiles we newly created (reused
 * profiles are left untouched). Riders are deleted last so their registrations
 * are already gone (FK).
 */
async function rollback(
  admin: ReturnType<typeof createAdminClient>,
  registrationIds: string[],
  riderIds: string[],
) {
  if (registrationIds.length > 0) {
    await admin.from("registrations").delete().in("id", registrationIds);
  }
  if (riderIds.length > 0) {
    await admin.from("riders").delete().in("id", riderIds);
  }
}

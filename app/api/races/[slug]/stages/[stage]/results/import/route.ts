import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOwnedRace } from "@/lib/races";
import {
  findDuplicatePositions,
  upsertResult,
  validateResultPayload,
  type ResultPayload,
} from "@/lib/results";
import { RESULTS_CSV_STATUSES } from "@/lib/results-csv";
import type { ResultStatus } from "@/types/app";

// POST /api/races/[slug]/stages/[stage]/results/import — bulk-imports a stage's
// results from a parsed CSV (Story 09). The client sends already-parsed rows
// (bib + status + time/position) as JSON; the server re-validates every row,
// resolves each bib to a registration, and only then writes. The import is
// atomic: it snapshots the stage's existing result rows for the affected
// registrations up front, upserts every row, and on any write failure restores
// the snapshot so a partial import never persists (mirrors the rider importer's
// rollback approach). Authenticates the session, confirms `races.organizer_id`
// matches, then writes with the service-role client (RLS is off — Story 01).

// One row as sent by the client (post-normalization, pre-write).
type ImportRow = {
  bib_number: number | null;
  status: ResultStatus | null;
  finish_time: string;
  position: number | null;
  dnf_reason: string | null;
  dsq_reason: string | null;
};

type ImportBody = { rows: ImportRow[] };

type RowError = { index: number; error: string };

type ResultSnapshot = {
  stage_id: string;
  registration_id: string;
  status: string;
  elapsed_seconds: number | null;
  net_seconds: number | null;
  position: number | null;
  group_position: number | null;
  finish_time: string | null;
  dnf_reason: string | null;
  dsq_reason: string | null;
  captured_at: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; stage: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { slug, stage: stageParam } = await params;
  const stageNumber = Number.parseInt(stageParam, 10);
  if (!Number.isInteger(stageNumber)) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  const admin = createAdminClient();
  const race = await loadOwnedRace(admin, slug, user.id);
  if (!race) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  const { data: stage } = await admin
    .from("stages")
    .select("*")
    .eq("race_id", race.id)
    .eq("stage_number", stageNumber)
    .maybeSingle();

  if (!stage) {
    return NextResponse.json({ error: "Etapa no encontrada." }, { status: 404 });
  }

  if (stage.results_locked) {
    return NextResponse.json(
      { error: "Los resultados de esta etapa están bloqueados." },
      { status: 409 },
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

  // Load the race's registrations to resolve bibs and check position
  // uniqueness within each category.
  const { data: registrations, error: regError } = await admin
    .from("registrations")
    .select("id, bib_number, category_id")
    .eq("race_id", race.id);

  if (regError) {
    return NextResponse.json(
      { error: "No se pudo importar. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const registrationByBib = new Map<number, { id: string; category_id: string }>();
  for (const r of registrations ?? []) {
    if (r.bib_number != null && r.category_id) {
      registrationByBib.set(r.bib_number, { id: r.id, category_id: r.category_id });
    }
  }

  // Resolve each row to a result payload, re-running validation server-side
  // (never trust the client's verdict). Build payloads up front so a single
  // bad row short-circuits before any write.
  const resolved: {
    registration_id: string;
    category_id: string;
    payload: ResultPayload;
    status: ResultStatus;
  }[] = [];
  const rowErrors: RowError[] = [];
  const seenBibs = new Set<number>();

  body.rows.forEach((row, index) => {
    if (row.bib_number == null || !Number.isInteger(row.bib_number) || row.bib_number < 1) {
      rowErrors.push({ index, error: "El dorsal debe ser un número entero positivo." });
      return;
    }
    if (seenBibs.has(row.bib_number)) {
      rowErrors.push({ index, error: "Este dorsal aparece más de una vez en el archivo." });
      return;
    }
    seenBibs.add(row.bib_number);

    const registration = registrationByBib.get(row.bib_number);
    if (!registration) {
      rowErrors.push({
        index,
        error: "No hay ningún corredor con este dorsal en la carrera.",
      });
      return;
    }

    if (!row.status || !RESULTS_CSV_STATUSES.includes(row.status)) {
      rowErrors.push({
        index,
        error: "El estado debe ser finished, dnf, dsq o dns.",
      });
      return;
    }

    const payload: ResultPayload = {
      registration_id: registration.id,
      status: row.status,
      finish_time: row.status === "finished" ? row.finish_time?.trim() || null : null,
      position: row.status === "finished" ? row.position : null,
      dnf_reason: row.status === "dnf" ? row.dnf_reason : null,
      dsq_reason: row.status === "dsq" ? row.dsq_reason : null,
    };

    // DNS is rejected by validateResultPayload (it's driven by registration on
    // the manual screen), but the importer accepts it as an explicit status;
    // upsertResult handles it (nulls time/position).
    if (row.status === "finished") {
      if (row.position == null) {
        rowErrors.push({
          index,
          error: "La posición es obligatoria cuando el estado es finished.",
        });
        return;
      }
      const validationError = validateResultPayload(payload);
      if (validationError) {
        rowErrors.push({ index, error: validationError });
        return;
      }
    } else if (row.status === "dnf" || row.status === "dsq") {
      const validationError = validateResultPayload(payload);
      if (validationError) {
        rowErrors.push({ index, error: validationError });
        return;
      }
    }

    resolved.push({
      registration_id: registration.id,
      category_id: registration.category_id,
      payload,
      status: row.status,
    });
  });

  if (rowErrors.length === 0) {
    // Cross-row: positions must be unique within each category.
    const duplicates = findDuplicatePositions(
      resolved
        .filter((r) => r.status === "finished")
        .map((r) => ({
          registration_id: r.registration_id,
          category_id: r.category_id,
          position: r.payload.position,
        })),
    );
    if (duplicates.size > 0) {
      resolved.forEach((r, index) => {
        if (duplicates.has(r.registration_id)) {
          rowErrors.push({
            index,
            error: "La posición está duplicada dentro de la categoría.",
          });
        }
      });
    }
  }

  if (rowErrors.length > 0) {
    return NextResponse.json(
      {
        error: "Hay filas con errores. Corrige el archivo e inténtalo de nuevo.",
        rowErrors,
      },
      { status: 422 },
    );
  }

  // Atomic write: snapshot the existing result rows for the affected
  // registrations so we can restore them if any upsert fails. Supabase has no
  // client-side transaction here, so we compensate manually.
  const affectedRegistrationIds = resolved.map((r) => r.registration_id);
  const { data: existingRows, error: snapshotError } = await admin
    .from("results")
    .select("*")
    .eq("stage_id", stage.id)
    .in("registration_id", affectedRegistrationIds);

  if (snapshotError) {
    return NextResponse.json(
      { error: "No se pudo importar. Inténtalo de nuevo." },
      { status: 500 },
    );
  }

  const snapshot = (existingRows ?? []) as ResultSnapshot[];
  const hadResult = new Set(snapshot.map((r) => r.registration_id));
  const writtenRegistrationIds: string[] = [];

  const summary = {
    imported: 0,
    finished: 0,
    dnf: 0,
    dsq: 0,
    dns: 0,
  };

  for (const item of resolved) {
    const result = await upsertResult(admin, stage.id, item.payload);
    if (!result.ok) {
      await rollback(admin, stage.id, snapshot, hadResult, writtenRegistrationIds);
      return NextResponse.json(
        {
          error:
            "No se pudo completar la importación. No se guardó ningún resultado. " +
            result.error,
        },
        { status: 409 },
      );
    }
    writtenRegistrationIds.push(item.registration_id);
    summary.imported += 1;
    summary[item.status] += 1;
  }

  return NextResponse.json({ summary }, { status: 201 });
}

/**
 * Best-effort rollback of a failed bulk import: for each registration we wrote,
 * restore its pre-import result row from the snapshot, or delete the row we
 * created when there was none before. This returns the stage's results to
 * exactly their pre-import state so no partial import persists.
 */
async function rollback(
  admin: ReturnType<typeof createAdminClient>,
  stageId: string,
  snapshot: ResultSnapshot[],
  hadResult: Set<string>,
  writtenRegistrationIds: string[],
) {
  const snapshotByRegistration = new Map(
    snapshot.map((r) => [r.registration_id, r]),
  );
  const toDelete: string[] = [];

  for (const registrationId of writtenRegistrationIds) {
    if (hadResult.has(registrationId)) {
      const original = snapshotByRegistration.get(registrationId);
      if (original) {
        await admin
          .from("results")
          .update({
            status: original.status,
            elapsed_seconds: original.elapsed_seconds,
            net_seconds: original.net_seconds,
            position: original.position,
            group_position: original.group_position,
            finish_time: original.finish_time,
            dnf_reason: original.dnf_reason,
            dsq_reason: original.dsq_reason,
            captured_at: original.captured_at,
          })
          .eq("stage_id", stageId)
          .eq("registration_id", registrationId);
      }
    } else {
      toDelete.push(registrationId);
    }
  }

  if (toDelete.length > 0) {
    await admin
      .from("results")
      .delete()
      .eq("stage_id", stageId)
      .in("registration_id", toDelete);
  }
}

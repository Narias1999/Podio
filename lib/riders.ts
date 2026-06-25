import type { createAdminClient } from "@/lib/supabase/admin";
import { categoryAge, suggestCategory } from "@/lib/categories";
import type { Category, Registration, Rider, Sex } from "@/types/app";

/**
 * Shared shapes/validation/creation logic for manual rider registration
 * (Story 06). Mirrors the pattern in `lib/stages.ts` / `lib/categories.ts`:
 * payload types + a validator reused by both the client (to gate submit) and
 * the server (to validate before writing). The `createRiderRegistration`
 * helper centralises the "create-or-reuse rider by document_number + create a
 * registration with the chosen/auto-suggested category" flow so the bulk CSV
 * importer (Story 07) can share exactly the same rules.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The immutable rider-profile fields plus the per-race registration fields
 * collected by the "add rider" panel. `category_id` may be null when nothing
 * was auto-suggested and the organizer hasn't picked one yet — validation
 * rejects that (a category is required), but the type allows the in-progress
 * draft state on the client.
 */
export type RiderRegistrationPayload = {
  document_number: string;
  name: string;
  sex: Sex | null;
  date_of_birth: string; // yyyy-MM-dd
  team: string | null;
  nationality: string | null;
  eps: string | null;
  phone: string | null;
  category_id: string | null;
};

/**
 * Returns a Spanish error string if the payload is invalid, otherwise null.
 * `categoryIds` is the set of category ids configured for the race; the chosen
 * `category_id` must belong to it.
 */
export function validateRiderRegistrationPayload(
  payload: RiderRegistrationPayload,
  categoryIds: readonly string[],
): string | null {
  if (!payload.document_number?.trim()) {
    return "El número de documento es obligatorio.";
  }
  if (!payload.name?.trim()) {
    return "El nombre es obligatorio.";
  }
  if (payload.sex !== "male" && payload.sex !== "female") {
    return "El sexo es obligatorio.";
  }
  if (!payload.date_of_birth || !DATE_RE.test(payload.date_of_birth)) {
    return "La fecha de nacimiento es obligatoria.";
  }
  if (!payload.category_id) {
    return "La categoría es obligatoria.";
  }
  if (!categoryIds.includes(payload.category_id)) {
    return "La categoría seleccionada no pertenece a esta carrera.";
  }
  return null;
}

/** The fields the organizer may edit on an existing registration (Story 06). */
export type RegistrationUpdatePayload = {
  category_id?: string;
  team?: string | null;
  eps?: string | null;
  phone?: string | null;
  nationality?: string | null;
  status?: "confirmed" | "dns";
  bib_number?: number | null;
};

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Computes the auto-suggested category for a rider given the race's
 * configured categories and start date. Returns the suggested `Category` or
 * `null` when nothing matches (Story 06 / Story 01 rule). Shared by the add
 * panel (client preselect) is done via `suggestCategory` directly; this
 * server-side variant is used by the CSV importer (Story 07) to fill in a
 * category when the row didn't specify one.
 */
export function suggestCategoryFor(
  categories: readonly Category[],
  rider: { date_of_birth: string; sex: Sex },
  raceStartsAt: string,
): Category | null {
  return suggestCategory(categories, {
    age: categoryAge(rider.date_of_birth, raceStartsAt),
    sex: rider.sex,
  });
}

export type CreateRiderRegistrationResult =
  | { ok: true; rider: Rider; registration: Registration; reusedRider: boolean }
  | { ok: false; error: string };

/**
 * Creates (or reuses by `document_number`) a global rider profile and links a
 * confirmation registration to the given race with the chosen category and an
 * empty bib (bibs are assigned later, on "close registration"). This is the
 * single source of truth for the create flow — the manual add panel route
 * (Story 06) and the bulk CSV importer (Story 07) both go through it.
 *
 * The caller is responsible for authorization (owning the race) and for
 * validating the payload first. When a rider with the document number already
 * exists, the existing profile is reused as-is (the global profile is not
 * overwritten by the new submission); only a registration is added.
 *
 * Guards against duplicate registration of the same rider in the same race.
 */
export async function createRiderRegistration(
  admin: Admin,
  raceId: string,
  payload: RiderRegistrationPayload,
): Promise<CreateRiderRegistrationResult> {
  const documentNumber = payload.document_number.trim();

  // Reuse an existing global rider profile by document_number, or create one.
  const { data: existing, error: lookupError } = await admin
    .from("riders")
    .select("*")
    .eq("document_number", documentNumber)
    .maybeSingle();

  if (lookupError) {
    return { ok: false, error: "No se pudo registrar el corredor. Inténtalo de nuevo." };
  }

  let rider = existing as Rider | null;
  const reusedRider = rider !== null;

  if (!rider) {
    const { data: inserted, error: insertError } = await admin
      .from("riders")
      .insert({
        document_number: documentNumber,
        name: payload.name.trim(),
        sex: payload.sex as Sex,
        date_of_birth: payload.date_of_birth,
        team: payload.team?.trim() || null,
        nationality: payload.nationality?.trim() || null,
        eps: payload.eps?.trim() || null,
        phone: payload.phone?.trim() || null,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      return { ok: false, error: "No se pudo registrar el corredor. Inténtalo de nuevo." };
    }
    rider = inserted;
  }

  // Block re-registering the same rider in the same race.
  const { data: dupe } = await admin
    .from("registrations")
    .select("id")
    .eq("race_id", raceId)
    .eq("rider_id", rider.id)
    .maybeSingle();

  if (dupe) {
    return { ok: false, error: "Este corredor ya está inscrito en la carrera." };
  }

  const { data: registration, error: registrationError } = await admin
    .from("registrations")
    .insert({
      race_id: raceId,
      rider_id: rider.id,
      category_id: payload.category_id as string,
      bib_number: null,
      status: "confirmed",
    })
    .select("*")
    .single();

  if (registrationError || !registration) {
    return { ok: false, error: "No se pudo inscribir el corredor. Inténtalo de nuevo." };
  }

  return { ok: true, rider, registration, reusedRider };
}

/**
 * Shuffles a copy of `items` (Fisher–Yates). Used to randomise bib assignment
 * within each category's contiguous range when closing registration.
 */
function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export type BibAssignment = {
  registration_id: string;
  bib_number: number;
};

export type CategoryBibRange = {
  category_id: string;
  category_name: string;
  count: number;
  from: number;
  to: number;
};

export type BibAssignmentPlan = {
  assignments: BibAssignment[];
  ranges: CategoryBibRange[];
};

/**
 * Computes the bib-assignment plan for closing registration (Story 06): walk
 * the categories in `sort_order`, allocate each a contiguous range starting at
 * `startNumber` sized to its confirmed-rider count (DNS excluded, since those
 * keep a null bib), and assign bibs randomly within the range. Categories with
 * no confirmed riders are skipped and consume no numbers. Pure function so the
 * route handler stays thin and this stays testable.
 */
export function planBibAssignments(
  categoriesInOrder: readonly Category[],
  confirmedByCategory: ReadonlyMap<string, readonly string[]>,
  startNumber = 1,
): BibAssignmentPlan {
  const assignments: BibAssignment[] = [];
  const ranges: CategoryBibRange[] = [];
  let next = startNumber;

  for (const category of categoriesInOrder) {
    const registrationIds = confirmedByCategory.get(category.id) ?? [];
    if (registrationIds.length === 0) continue;

    const from = next;
    const to = next + registrationIds.length - 1;
    const bibs = shuffle(
      Array.from({ length: registrationIds.length }, (_, i) => from + i),
    );
    registrationIds.forEach((registrationId, i) => {
      assignments.push({ registration_id: registrationId, bib_number: bibs[i] });
    });
    ranges.push({
      category_id: category.id,
      category_name: category.name,
      count: registrationIds.length,
      from,
      to,
    });
    next = to + 1;
  }

  return { assignments, ranges };
}

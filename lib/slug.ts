/**
 * Slug generation for race URLs (Story 03).
 *
 * `slugify` turns a race name into a URL-safe slug: lowercased, accents
 * stripped (e.g. "Tour de Bogotá 2026" -> "tour-de-bogota-2026"), non-alphanumeric
 * runs collapsed to single hyphens, and leading/trailing hyphens trimmed.
 *
 * `uniqueSlug` resolves collisions against a set of taken slugs by appending a
 * short numeric suffix ("-2", "-3", ...).
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    // strip combining diacritical marks
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Returns a slug derived from `name` that is not present in `taken`. If the base
 * slug is free it is returned as-is; otherwise the lowest available `-N` suffix
 * (starting at 2) is appended. Falls back to "carrera" when the name produces an
 * empty slug.
 */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const base = slugify(name) || "carrera";
  const takenSet = new Set(taken);

  if (!takenSet.has(base)) {
    return base;
  }

  let suffix = 2;
  while (takenSet.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

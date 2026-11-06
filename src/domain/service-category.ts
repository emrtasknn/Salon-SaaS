/** Tenant-defined service groups (owner decision 2026-11-06). */
export type ServiceCategoryRecord = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
}>;

/** Matches the VARCHAR(60) column. */
export const SERVICE_CATEGORY_NAME_MAX_LENGTH = 60;
/** Matches the DB CHECK on "sortOrder". */
export const SERVICE_CATEGORY_SORT_MAX = 10_000;
/** Group label for services without a category when other groups exist. */
export const UNCATEGORIZED_LABEL = "Diğer";

export function normalizeCategoryName(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Category name is invalid");
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > SERVICE_CATEGORY_NAME_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new TypeError("Category name is invalid");
  }
  return normalized;
}

export type ServiceGroup<S> = Readonly<{ id: string | null; name: string | null; services: S[] }>;

/**
 * Groups services for display: categories by sortOrder (then name), services keep their given
 * order, empty categories are hidden, uncategorized services (or ones whose category is gone)
 * go last as "Diğer". When no category is in use the single group has no name (no heading).
 */
export function groupServicesByCategory<S extends Readonly<{ categoryId?: string | null }>>(
  categories: ReadonlyArray<Readonly<{ id: string; name: string; sortOrder: number }>>,
  services: ReadonlyArray<S>,
): ServiceGroup<S>[] {
  const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr"));
  const known = new Set(ordered.map((category) => category.id));
  const groups: ServiceGroup<S>[] = ordered
    .map((category) => ({
      id: category.id,
      name: category.name,
      services: services.filter((service) => service.categoryId === category.id),
    }))
    .filter((group) => group.services.length > 0);
  const rest = services.filter((service) => !service.categoryId || !known.has(service.categoryId));
  if (rest.length > 0) groups.push({ id: null, name: groups.length > 0 ? UNCATEGORIZED_LABEL : null, services: rest });
  return groups;
}

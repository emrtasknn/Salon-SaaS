export type ServiceRecord = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  active: boolean;
  /** Owner decision 2026-11-06: optional category (same tenant) and price in kuruş. */
  categoryId?: string | null;
  priceMinor?: number | null;
  priceIsFrom?: boolean;
}>;

export const SERVICE_NAME_MAX_LENGTH = 120;
export const SERVICE_DURATION_MAX_MINUTES = 24 * 60;
export const SERVICE_BUFFER_MAX_MINUTES = 24 * 60;

function isControlFreeText(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/.test(value);
}

export function normalizeServiceName(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Service name is invalid");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > SERVICE_NAME_MAX_LENGTH || !isControlFreeText(normalized)) {
    throw new TypeError("Service name is invalid");
  }
  return normalized;
}

export const ARCHIVED_SERVICE_NAME_MAX_ATTEMPTS = 50;

/**
 * Candidate names for an archived service whose name is being reused, in
 * preference order: "X (silindi)", "X (silindi 2)", ... up to 50. The base name
 * (never the suffix) is truncated so each candidate fits the name limit.
 */
export function archivedServiceNameCandidates(
  name: string,
  maxLength: number = SERVICE_NAME_MAX_LENGTH,
): string[] {
  const candidates: string[] = [];
  for (let attempt = 1; attempt <= ARCHIVED_SERVICE_NAME_MAX_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 1 ? " (silindi)" : ` (silindi ${attempt})`;
    const base = name.slice(0, Math.max(0, maxLength - suffix.length)).trimEnd();
    candidates.push(`${base}${suffix}`);
  }
  return candidates;
}

/** First free archived-name candidate, or null when all 50 are taken. */
export function chooseArchivedServiceName(
  name: string,
  takenNames: ReadonlySet<string>,
  maxLength: number = SERVICE_NAME_MAX_LENGTH,
): string | null {
  return archivedServiceNameCandidates(name, maxLength).find((candidate) => !takenNames.has(candidate)) ?? null;
}

export function createServiceDurationMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > SERVICE_DURATION_MAX_MINUTES) {
    throw new TypeError("Service duration is invalid");
  }
  return value;
}

export function createServiceBufferMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > SERVICE_BUFFER_MAX_MINUTES) {
    throw new TypeError("Service buffer is invalid");
  }
  return value;
}

export function isServiceBookable(active: boolean): boolean {
  return active;
}

export function createServiceRecord(input: {
  id: string;
  tenantId: string;
  name: unknown;
  durationMinutes: unknown;
  bufferMinutes: unknown;
  active?: unknown;
}): ServiceRecord {
  if (typeof input.id !== "string" || input.id.length === 0) throw new TypeError("Service id is invalid");
  if (typeof input.tenantId !== "string" || input.tenantId.length === 0) throw new TypeError("Service tenant is invalid");
  if (input.active !== undefined && typeof input.active !== "boolean") throw new TypeError("Service active state is invalid");

  return Object.freeze({
    id: input.id,
    tenantId: input.tenantId,
    name: normalizeServiceName(input.name),
    durationMinutes: createServiceDurationMinutes(input.durationMinutes),
    bufferMinutes: createServiceBufferMinutes(input.bufferMinutes),
    active: input.active ?? true,
  });
}

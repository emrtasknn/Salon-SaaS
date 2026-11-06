// Multi-service appointments (owner decision 2026-11-06): one staff member, services back to back.
// Total time = sum of each service's (duration + buffer), which is exactly how a single service
// is booked today, so availability and the conflict check stay the same.

/** Up to 5 services per appointment (primary + 4 extra); matches the DB CHECK on position. */
export const MAX_SERVICES_PER_APPOINTMENT = 5;

export type ServiceTiming = Readonly<{ durationMinutes: number; bufferMinutes: number }>;

/**
 * Combined timing for services in order: the buffers between services count as service time,
 * the last service's buffer stays the buffer. duration + buffer always equals the full sum.
 */
export function combineServiceTimings(services: ReadonlyArray<ServiceTiming>): ServiceTiming {
  if (services.length === 0) throw new TypeError("At least one service is required");
  const total = services.reduce((sum, service) => sum + service.durationMinutes + service.bufferMinutes, 0);
  const lastBuffer = services[services.length - 1].bufferMinutes;
  return { durationMinutes: total - lastBuffer, bufferMinutes: lastBuffer };
}

/** "Kesim + Sakal" for multi-service appointments; the primary name alone otherwise. */
export function appointmentServiceLabel(primaryName: string, orderedNames: ReadonlyArray<string> = []): string {
  return orderedNames.length > 1 ? orderedNames.join(" + ") : primaryName;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Validates the extra services sent after the primary one. Absent/empty = single service.
 * Rejects duplicates, the primary repeated, non-ids and more than MAX - 1 extras.
 */
export function normalizeExtraServiceIds(primaryServiceId: string, extra: unknown): string[] | "INVALID" {
  if (extra === undefined || extra === null) return [];
  if (!Array.isArray(extra) || extra.length > MAX_SERVICES_PER_APPOINTMENT - 1 || !extra.every(isId)) return "INVALID";
  const ids = extra as string[];
  if (new Set(ids).size !== ids.length || ids.includes(primaryServiceId)) return "INVALID";
  return ids;
}

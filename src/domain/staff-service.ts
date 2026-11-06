// Owner decision 2026-11-06: which services a staff member performs.
// No mapping rows = performs every service (so salons that never set it are unchanged).

/** True when a staff member with these mapped service ids may take `serviceId`. */
export function staffPerformsService(mappedServiceIds: ReadonlyArray<string>, serviceId: string): boolean {
  return mappedServiceIds.length === 0 || mappedServiceIds.includes(serviceId);
}

/** Upper bound for one staff member's mapping list (a salon's whole catalog fits easily). */
export const STAFF_SERVICE_MAX = 200;

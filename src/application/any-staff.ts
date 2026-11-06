// "Fark etmez" (any staff) for public booking (owner decision 2026-11-06).
// The customer does not pick a staff member; the server offers the union of the salon's ACTIVE
// staff slots and, at submit time, assigns a free staff member. The candidate list always comes
// from the server-side catalog for the tenant resolved from the slug, never from client input.

export const ANY_STAFF_ID = "any";

export type Slot = Readonly<{ startAtIso: string; endAtIso: string }>;
export type StaffSlots = Readonly<{ staffId: string; slots: ReadonlyArray<Slot> }>;

/** Union of every staff member's free slots for the day, one entry per start time, in time order. */
export function mergeAnyStaffSlots(perStaff: ReadonlyArray<StaffSlots>): Slot[] {
  const byStart = new Map<string, Slot>();
  for (const staff of perStaff) {
    for (const slot of staff.slots) if (!byStart.has(slot.startAtIso)) byStart.set(slot.startAtIso, slot);
  }
  return [...byStart.values()].sort((a, b) => Date.parse(a.startAtIso) - Date.parse(b.startAtIso));
}

/**
 * Staff who are free at `startAtIso`, least busy first (most free slots left that day), so work
 * spreads across the team. Ties keep the catalog order, which keeps the choice deterministic.
 */
export function staffOrderForSlot(perStaff: ReadonlyArray<StaffSlots>, startAtIso: string): string[] {
  const target = Date.parse(startAtIso);
  return perStaff
    .map((staff, index) => ({ staff, index }))
    .filter(({ staff }) => staff.slots.some((slot) => Date.parse(slot.startAtIso) === target))
    .sort((a, b) => b.staff.slots.length - a.staff.slots.length || a.index - b.index)
    .map(({ staff }) => staff.staffId);
}

/** Salon-local calendar date (YYYY-MM-DD) of an instant. */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// Pure helpers for the 3-step public booking flow (presentation only; the server stays authoritative).

export type BookingStep = 1 | 2 | 3;

export const BOOKING_STEP_TITLES: Record<BookingStep, string> = {
  1: "Hizmet seçin",
  2: "Uzman ve saat",
  3: "Bilgileriniz",
};

/** Customers who arrive with a service already chosen (?service=) start at step 2. */
export function initialStep(initialServiceId: string): BookingStep {
  return initialServiceId ? 2 : 1;
}

export type StripDay = Readonly<{ iso: string; weekday: string; day: string; month: string }>;

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * `count` consecutive calendar days starting at `startIso` (a salon-local YYYY-MM-DD).
 * Labels are computed at UTC noon of each date, so they never shift with the viewer's zone.
 */
export function dateStrip(startIso: string, count = 14): StripDay[] {
  const weekday = new Intl.DateTimeFormat("tr-TR", { weekday: "short", timeZone: "UTC" });
  const month = new Intl.DateTimeFormat("tr-TR", { month: "short", timeZone: "UTC" });
  return Array.from({ length: count }, (_, i) => {
    const iso = addDays(startIso, i);
    const noon = new Date(`${iso}T12:00:00.000Z`);
    return { iso, weekday: weekday.format(noon), day: String(Number(iso.slice(8, 10))), month: month.format(noon) };
  });
}

/** Long salon-local label for a YYYY-MM-DD date, e.g. "7 Kasım Cumartesi". */
export function formatDateLong(dateIso: string): string {
  return new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${dateIso}T12:00:00.000Z`),
  );
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export type SlotGroup<T> = Readonly<{ label: string; slots: T[] }>;

/** Groups slots into Sabah (<12), Öğleden sonra (12–17), Akşam (≥17) by salon-local hour; empty groups are dropped. */
export function groupSlots<T extends { startAtIso: string }>(slots: ReadonlyArray<T>, timeZone: string): SlotGroup<T>[] {
  const hourOf = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" });
  const groups: Array<{ label: string; slots: T[] }> = [
    { label: "Sabah", slots: [] },
    { label: "Öğleden sonra", slots: [] },
    { label: "Akşam", slots: [] },
  ];
  for (const slot of slots) {
    const hour = Number(hourOf.format(new Date(slot.startAtIso)));
    groups[hour < 12 ? 0 : hour < 17 ? 1 : 2].slots.push(slot);
  }
  return groups.filter((group) => group.slots.length > 0);
}

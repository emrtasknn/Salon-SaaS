import type { TourId } from "./tour-steps";

// Whether the first-visit tour was seen, stored on this device only (like theme and calendar
// view). Not authoritative for anything: losing it just shows the tour once more.
// Bump a tour's version when its content changes enough to be worth showing again.
// staff v2: the staff area got a home screen ("Özet") and the calendar moved to its own tab.
export const TOUR_STORAGE_VERSIONS: Readonly<Record<TourId, number>> = { admin: 1, staff: 2 };

export function tourStorageKey(id: TourId): string {
  return `salon-saas:tour:v${TOUR_STORAGE_VERSIONS[id]}:${id}`;
}

type TourStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, or null where it is missing or blocked (SSR, private mode, disabled site data). */
export function browserTourStorage(): TourStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Unknown counts as seen, so a blocked storage never replays the tour on every page load. */
export function hasSeenTour(storage: TourStorage | null, id: TourId): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(tourStorageKey(id)) !== null;
  } catch {
    return true;
  }
}

export function markTourSeen(storage: TourStorage | null, id: TourId, now: Date = new Date()): void {
  try {
    storage?.setItem(tourStorageKey(id), now.toISOString());
  } catch {
    // Best effort: the tour simply shows again next time.
  }
}

export function resetTour(storage: TourStorage | null, id: TourId): void {
  try {
    storage?.removeItem(tourStorageKey(id));
  } catch {
    // Best effort.
  }
}

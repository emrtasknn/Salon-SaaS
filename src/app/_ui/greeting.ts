// Pure date helpers for the signed-in greeting header. Display only.

export const GREETING_TIME_ZONE = "Europe/Istanbul";

/** "5 Kasım Perşembe" in tr-TR for the given instant (Europe/Istanbul). */
export function formatGreetingDate(now: Date, timeZone = GREETING_TIME_ZONE): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone, day: "numeric", month: "long", weekday: "long" }).format(now);
}

/** Local calendar date (YYYY-MM-DD) of `now` in the given zone. */
export function localDateIso(now: Date, timeZone = GREETING_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

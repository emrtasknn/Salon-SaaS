import { createHash } from "node:crypto";
import { localWallTimeToUtc } from "./availability";

// ADR-045 phase C: the small part of RFC 5545 the RandevuN CalDAV account needs. Reads the
// first VEVENT a phone sends (times, title, free/busy) and nothing else. Pure, no I/O.

export const MAX_ICS_BYTES = 65_536;
const MAX_TITLE = 200;
/** Events without an end: assume this length so they still have an interval. */
const DEFAULT_EVENT_MINUTES = 30;

export type ParsedPhoneEvent = Readonly<{
  uid: string;
  title: string | null;
  startAt: Date;
  endAt: Date;
  /** All-day or marked "free" on the phone: shown in the app, never closes a slot. */
  blocksTime: boolean;
  /** RRULE present: only the first occurrence is used (documented limit). */
  recurring: boolean;
}>;

/** RFC 5545 §3.1: a line starting with a space or tab continues the previous one. */
export function unfoldIcs(text: string): string[] {
  return text.replace(/\r\n[ \t]|\n[ \t]/g, "").split(/\r?\n/);
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

type Property = Readonly<{ name: string; params: Readonly<Record<string, string>>; value: string }>;

function parseLine(line: string): Property | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const [name, ...rawParams] = head.split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const eq = raw.indexOf("=");
    if (eq > 0) params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** First ":" that is not inside a quoted parameter value. */
function findValueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) return i;
  }
  return -1;
}

function zoneOrDefault(tzid: string | undefined, fallback: string): string {
  if (!tzid) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tzid });
    return tzid;
  } catch {
    return fallback;
  }
}

/** DATE-TIME / DATE value to an instant. Floating and unknown zones use the salon's zone. */
function parseDateValue(prop: Property, defaultTz: string): { at: Date; allDay: boolean } | null {
  const value = prop.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const zone = zoneOrDefault(prop.params.TZID, defaultTz);
  if (date || prop.params.VALUE === "DATE") {
    if (!date) return null;
    try {
      return { at: localWallTimeToUtc(`${date[1]}-${date[2]}-${date[3]}`, 0, zone), allDay: true };
    } catch {
      return null;
    }
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return Number.isNaN(at.getTime()) ? null : { at, allDay: false };
  }
  try {
    const at = localWallTimeToUtc(`${y}-${mo}-${d}`, +h * 60 + +mi, zone);
    return { at: new Date(at.getTime() + +s * 1000), allDay: false };
  } catch {
    return null;
  }
}

/** ISO 8601 duration as used in ICS ("PT1H30M", "P1D", "-PT15M" is rejected). */
export function parseDurationMs(value: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m || value.trim() === "P" || value.trim() === "PT") return null;
  const [, w, d, h, mi, s] = m.map((part) => Number(part ?? 0));
  return (((w * 7 + d) * 24 + h) * 60 + mi) * 60_000 + s * 1000;
}

/**
 * The first VEVENT of an iCalendar object a phone PUTs. Null when it has no usable VEVENT
 * (no UID, no start, or an end before the start).
 */
export function parsePhoneEvent(ics: string, defaultTz: string): ParsedPhoneEvent | null {
  const lines = unfoldIcs(ics);
  let inEvent = false;
  let depth = 0; // nested components inside the VEVENT (VALARM)
  const props: Property[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (!inEvent) {
      if (upper === "BEGIN:VEVENT") inEvent = true;
      continue;
    }
    if (upper.startsWith("BEGIN:")) depth++;
    else if (upper.startsWith("END:")) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0) {
      const prop = parseLine(line);
      if (prop) props.push(prop);
    }
  }
  const get = (name: string) => props.find((p) => p.name === name);
  const uid = get("UID")?.value.trim();
  const startProp = get("DTSTART");
  if (!uid || uid.length > 255 || !startProp) return null;
  const start = parseDateValue(startProp, defaultTz);
  if (!start) return null;

  let endAt: Date | null = null;
  const endProp = get("DTEND");
  const durationProp = get("DURATION");
  if (endProp) endAt = parseDateValue(endProp, defaultTz)?.at ?? null;
  else if (durationProp) {
    const ms = parseDurationMs(durationProp.value);
    if (ms !== null) endAt = new Date(start.at.getTime() + ms);
  }
  if (!endAt) endAt = new Date(start.at.getTime() + (start.allDay ? 24 * 60 : DEFAULT_EVENT_MINUTES) * 60_000);
  if (endAt.getTime() <= start.at.getTime()) {
    if (endAt.getTime() < start.at.getTime()) return null;
    endAt = new Date(start.at.getTime() + DEFAULT_EVENT_MINUTES * 60_000);
  }

  const summary = get("SUMMARY")?.value;
  const title = summary ? unescapeText(summary).trim().slice(0, MAX_TITLE) || null : null;
  const transparent = get("TRANSP")?.value.trim().toUpperCase() === "TRANSPARENT";
  const cancelled = get("STATUS")?.value.trim().toUpperCase() === "CANCELLED";
  return {
    uid,
    title,
    startAt: start.at,
    endAt,
    blocksTime: !start.allDay && !transparent && !cancelled,
    recurring: Boolean(get("RRULE")),
  };
}

/** Strong ETag for a stored body (quoted, as HTTP wants it). */
export function etagOf(body: string): string {
  return `"${createHash("sha256").update(body, "utf8").digest("base64url").slice(0, 32)}"`;
}

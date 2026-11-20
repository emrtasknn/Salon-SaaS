// ADR-045 phase C: the WebDAV/CalDAV XML the RandevuN account needs (RFC 4918, 4791 and the
// Apple/CalendarServer extensions iOS reads). Requests are small and come from calendar
// clients, so a namespace-agnostic local-name scan is enough; responses are built from
// escaped strings only. Pure, no I/O.

export const NS = {
  D: "DAV:",
  C: "urn:ietf:params:xml:ns:caldav",
  CS: "http://calendarserver.org/ns/",
  A: "http://apple.com/ns/ical/",
} as const;

/** Namespace prefix of every property this server knows (anything else is "not found"). */
const PROP_PREFIX: Record<string, keyof typeof NS> = {
  "resourcetype": "D",
  "displayname": "D",
  "getetag": "D",
  "getcontenttype": "D",
  "current-user-principal": "D",
  "principal-URL": "D",
  "owner": "D",
  "current-user-privilege-set": "D",
  "supported-report-set": "D",
  "sync-token": "D",
  "calendar-home-set": "C",
  "calendar-data": "C",
  "supported-calendar-component-set": "C",
  "calendar-description": "C",
  "calendar-timezone": "C",
  "calendar-user-address-set": "C",
  "getctag": "CS",
  "calendar-color": "A",
  "calendar-order": "A",
};

export function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripDeclaration(xml: string): string {
  return xml.replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** Local name of the root element ("propfind", "calendar-multiget", …) or null. */
export function rootElement(xml: string): string | null {
  const m = /<(?:[A-Za-z0-9_-]+:)?([A-Za-z-]+)[\s/>]/.exec(stripDeclaration(xml));
  return m ? m[1] : null;
}

/** Property local names listed inside the first <prop>; empty when the body asks for allprop. */
export function requestedProps(xml: string): string[] {
  const body = stripDeclaration(xml);
  const m = /<(?:[A-Za-z0-9_-]+:)?prop(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?prop>/.exec(body);
  if (!m) return [];
  const names: string[] = [];
  // Only top-level children: skip anything nested inside a prop (e.g. calendar-data's <comp>).
  let depth = 0;
  for (const tag of m[1].matchAll(/<(\/?)(?:[A-Za-z0-9_-]+:)?([A-Za-z-]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = tag;
    if (closing) {
      depth--;
      continue;
    }
    if (depth === 0 && !names.includes(name)) names.push(name);
    if (!selfClosing) depth++;
  }
  return names;
}

export function requestedHrefs(xml: string): string[] {
  return [...stripDeclaration(xml).matchAll(/<(?:[A-Za-z0-9_-]+:)?href(?:\s[^>]*)?>([^<]+)<\/(?:[A-Za-z0-9_-]+:)?href>/g)].map((m) =>
    m[1].trim().replace(/&amp;/g, "&"),
  );
}

/** <C:time-range start=".." end=".."/> of a calendar-query, as instants. */
export function requestedTimeRange(xml: string): { start: Date | null; end: Date | null } {
  const m = /<(?:[A-Za-z0-9_-]+:)?time-range([^>]*)\/?>/.exec(xml);
  const parse = (attr: string) => {
    const v = m ? new RegExp(`${attr}="(\\d{8}T\\d{6}Z)"`).exec(m[1])?.[1] : undefined;
    if (!v) return null;
    const at = new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}Z`);
    return Number.isNaN(at.getTime()) ? null : at;
  };
  return { start: parse("start"), end: parse("end") };
}

export type PropValues = Readonly<Record<string, string>>;

export type DavResponse = Readonly<{
  href: string;
  /** Inner XML of each found property (already escaped). */
  found: PropValues;
  /** Asked-for properties this resource does not have. */
  missing: readonly string[];
}>;

function propTag(name: string, inner: string): string {
  const prefix = PROP_PREFIX[name] ?? "D";
  return inner === "" ? `<${prefix}:${name}/>` : `<${prefix}:${name}>${inner}</${prefix}:${name}>`;
}

/** 207 Multi-Status body. */
export function multistatus(responses: readonly DavResponse[]): string {
  const parts = responses.map((r) => {
    const found = Object.entries(r.found);
    const ok = found.length
      ? `<D:propstat><D:prop>${found.map(([n, v]) => propTag(n, v)).join("")}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>`
      : "";
    const missing = r.missing.length
      ? `<D:propstat><D:prop>${r.missing.map((n) => propTag(n, "")).join("")}</D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>`
      : "";
    return `<D:response><D:href>${escapeXml(r.href)}</D:href>${ok}${missing}</D:response>`;
  });
  const xmlns = Object.entries(NS).map(([p, uri]) => `xmlns:${p}="${uri}"`).join(" ");
  return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus ${xmlns}>${parts.join("")}</D:multistatus>`;
}

/** Picks the asked-for props out of everything a resource offers (all of them for allprop). */
export function selectProps(available: PropValues, asked: readonly string[]): { found: PropValues; missing: string[] } {
  if (asked.length === 0) return { found: available, missing: [] };
  const found: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of asked) {
    if (name in available) found[name] = available[name];
    else missing.push(name);
  }
  return { found, missing };
}

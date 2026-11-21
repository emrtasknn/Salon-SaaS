// ADR-045 phase C: the RandevuN CalDAV calendar account (RFC 4791 subset that iOS Calendar,
// macOS Calendar and DAVx5 use). One calendar per account, at
//   /dav/u/<username>/cal/randevun/
// containing the user's appointments (read-only, "a-<id>.ics") and the events the user creates
// on the phone (writable, any other name). Tenant comes from the username's slug, the holder
// from the stored account row; role and active staff state are re-checked on every request.

import { buildCalendarFeed, type FeedAppointment } from "../domain/calendar-feed";
import { verifyPassword, parseBasicAuth } from "../domain/caldav-credentials";
import { etagOf, MAX_ICS_BYTES, parsePhoneEvent } from "../domain/caldav-ics";
import {
  escapeXml,
  multistatus,
  requestedHrefs,
  requestedProps,
  requestedPropsQualified,
  requestedTimeRange,
  rootElement,
  selectProps,
  type DavResponse,
  type PropValues,
} from "../domain/caldav-xml";
import type { TenantContext } from "../domain/tenant-context";
import type { FeedHolder } from "./calendar-feed";

export type DavAccount = Readonly<{ id: string; profileId: string; username: string; passwordHash: string; lastSeenAt: Date | null }>;
export type StoredPhoneEvent = Readonly<{ href: string; etag: string; ics: string; startAt: Date; endAt: Date }>;

export interface CalDavRepository {
  findLiveAccount(tenantContext: TenantContext, username: string): Promise<DavAccount | null>;
  touchAccount(tenantContext: TenantContext, accountId: string, now: Date): Promise<void>;
  readHolder(tenantContext: TenantContext, profileId: string): Promise<FeedHolder>;
  listAppointments(tenantContext: TenantContext, input: { staffId: string | null; from: Date; to: Date }): Promise<FeedAppointment[]>;
  listEvents(tenantContext: TenantContext, accountId: string): Promise<StoredPhoneEvent[]>;
  saveEvent(
    tenantContext: TenantContext,
    input: { accountId: string; staffId: string | null; href: string; uid: string; etag: string; ics: string; title: string | null; startAt: Date; endAt: Date; blocksTime: boolean },
  ): Promise<void>;
  deleteEvent(tenantContext: TenantContext, accountId: string, href: string): Promise<boolean>;
}

export type DavTenant = Readonly<{ tenantContext: TenantContext; name: string; timezone: string }>;

export type DavRequest = Readonly<{
  method: string;
  pathname: string;
  authorization: string | null;
  depth: string | null;
  ifMatch: string | null;
  ifNoneMatch: string | null;
  body: string;
  now: Date;
}>;

export type DavResult = Readonly<{ status: number; headers: Record<string, string>; body: string | null }>;

const XML = { "Content-Type": "application/xml; charset=utf-8" };
const ICS_TYPE = "text/calendar; charset=utf-8";
const DAV_HEADERS = {
  DAV: "1, 3, calendar-access",
  Allow: "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT",
};
const CALENDAR_NAME = "randevun";
/** Appointments shown: 30 days back to 180 ahead (same as the subscription feed). */
const PAST_MS = 30 * 86_400_000;
const FUTURE_MS = 180 * 86_400_000;
const TOUCH_EVERY_MS = 5 * 60_000;
const APPOINTMENT_PREFIX = "a-";
const HREF_NAME = /^[A-Za-z0-9._@%+-]{1,255}$/;

const result = (status: number, body: string | null = null, headers: Record<string, string> = {}): DavResult => ({
  status,
  headers: { ...DAV_HEADERS, ...headers },
  body,
});

type Item = Readonly<{ name: string; etag: string; ics: string; readOnly: boolean; startAt: Date; endAt: Date }>;

/** Paths this server answers, relative to /dav. */
type Route =
  | { kind: "root" }
  | { kind: "principal"; user: string }
  | { kind: "home"; user: string }
  | { kind: "calendar"; user: string }
  | { kind: "item"; user: string; name: string };

export function routeOf(pathname: string): Route | null {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "\u0000";
    }
  });
  if (parts[0] !== "dav") return null;
  if (parts.length === 1) return { kind: "root" };
  if (parts[1] !== "u" || !parts[2]) return null;
  const user = parts[2].toLowerCase();
  if (parts.length === 3) return { kind: "principal", user };
  if (parts[3] !== "cal") return null;
  if (parts.length === 4) return { kind: "home", user };
  if (parts[4] !== CALENDAR_NAME) return null;
  if (parts.length === 5) return { kind: "calendar", user };
  if (parts.length === 6 && HREF_NAME.test(parts[5])) return { kind: "item", user, name: parts[5] };
  return null;
}

export function createCalDavService(deps: {
  repository: CalDavRepository;
  resolveTenantBySlug: (slug: string) => Promise<DavTenant | null>;
  hit: (bucket: "dav.request" | "dav.miss") => Promise<"allowed" | "limited">;
  appUrl: (adminScope: boolean) => string | null;
}) {
  const { repository } = deps;
  const paths = (user: string) => {
    const principal = `/dav/u/${encodeURIComponent(user)}/`;
    const home = `${principal}cal/`;
    const calendar = `${home}${CALENDAR_NAME}/`;
    return { principal, home, calendar };
  };

  async function authenticate(request: DavRequest) {
    const credentials = parseBasicAuth(request.authorization);
    const unauthorized = async () => {
      if ((await deps.hit("dav.miss")) === "limited") return { error: result(429, null, { "Retry-After": "600" }) };
      return { error: result(401, null, { "WWW-Authenticate": 'Basic realm="RandevuN", charset="UTF-8"' }) };
    };
    if (!credentials) return unauthorized();
    if ((await deps.hit("dav.request")) === "limited") return { error: result(429, null, { "Retry-After": "600" }) };
    const tenant = await deps.resolveTenantBySlug(credentials.slug);
    const account = tenant ? await repository.findLiveAccount(tenant.tenantContext, credentials.username) : null;
    if (!tenant || !account || !verifyPassword(credentials.password, account.passwordHash)) return unauthorized();
    const holder = await repository.readHolder(tenant.tenantContext, account.profileId);
    const isAdmin = holder.role === "TENANT_ADMIN" || holder.role === "SUPER_ADMIN";
    const staffId = holder.staffActive ? holder.staffId : null;
    // A removed member, or staff without an active staff row, can no longer sign in.
    if (!isAdmin && !staffId) return unauthorized();
    if (!account.lastSeenAt || request.now.getTime() - account.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await repository.touchAccount(tenant.tenantContext, account.id, request.now);
    }
    return { session: { tenant, account, isAdmin, staffId } };
  }

  type Session = Readonly<{ tenant: DavTenant; account: DavAccount; isAdmin: boolean; staffId: string | null }>;

  async function items(session: Session, now: Date): Promise<Item[]> {
    const ctx = session.tenant.tenantContext;
    // Admin: the whole salon (with staff names). Staff: their own appointments.
    const adminScope = session.isAdmin;
    const appointments = await repository.listAppointments(ctx, {
      staffId: adminScope ? null : session.staffId,
      from: new Date(now.getTime() - PAST_MS),
      to: new Date(now.getTime() + FUTURE_MS),
    });
    const appUrl = deps.appUrl(adminScope);
    const fromAppointments = appointments.map((a): Item => {
      const shown = adminScope ? a : { ...a, staffName: null };
      const ics = buildCalendarFeed({ calendarName: "RandevuN", appointments: [shown], now: a.updatedAt, appUrl });
      return { name: `${APPOINTMENT_PREFIX}${a.id}.ics`, etag: etagOf(ics), ics, readOnly: true, startAt: a.startAt, endAt: a.endAt };
    });
    const events = await repository.listEvents(ctx, session.account.id);
    return [
      ...fromAppointments,
      ...events.map((e): Item => ({ name: e.href, etag: e.etag, ics: e.ics, readOnly: false, startAt: e.startAt, endAt: e.endAt })),
    ];
  }

  const ctagOf = (list: readonly Item[]) => etagOf(list.map((i) => `${i.name}=${i.etag}`).sort().join("\n"));

  function collectionProps(session: Session, list: readonly Item[]): PropValues {
    const p = paths(session.account.username);
    const ctag = ctagOf(list);
    return {
      resourcetype: "<D:collection/><C:calendar/>",
      displayname: "RandevuN",
      "calendar-description": escapeXml(`${session.tenant.name} randevuları`),
      "supported-calendar-component-set": '<C:comp name="VEVENT"/>',
      getctag: escapeXml(ctag),
      getetag: escapeXml(ctag),
      "calendar-color": "#1F3B38FF",
      "current-user-principal": `<D:href>${escapeXml(p.principal)}</D:href>`,
      owner: `<D:href>${escapeXml(p.principal)}</D:href>`,
      "current-user-privilege-set":
        "<D:privilege><D:read/></D:privilege><D:privilege><D:write/></D:privilege><D:privilege><D:write-content/></D:privilege><D:privilege><D:bind/></D:privilege><D:privilege><D:unbind/></D:privilege>",
      "supported-report-set":
        "<D:supported-report><D:report><C:calendar-multiget/></D:report></D:supported-report><D:supported-report><D:report><C:calendar-query/></D:report></D:supported-report>",
    };
  }

  function itemProps(item: Item, withData: boolean): PropValues {
    return {
      getetag: escapeXml(item.etag),
      getcontenttype: `${ICS_TYPE}; component=vevent`,
      resourcetype: "",
      ...(withData ? { "calendar-data": escapeXml(item.ics) } : {}),
    };
  }

  function principalProps(session: Session, displayName: string): PropValues {
    const p = paths(session.account.username);
    return {
      resourcetype: "<D:principal/><D:collection/>",
      displayname: escapeXml(displayName),
      "current-user-principal": `<D:href>${escapeXml(p.principal)}</D:href>`,
      "principal-URL": `<D:href>${escapeXml(p.principal)}</D:href>`,
      "calendar-home-set": `<D:href>${escapeXml(p.home)}</D:href>`,
      "calendar-user-address-set": `<D:href>${escapeXml(p.principal)}</D:href>`,
      "principal-collection-set": "<D:href>/dav/u/</D:href>",
      "current-user-privilege-set": "<D:privilege><D:read/></D:privilege>",
    };
  }

  async function propfind(session: Session, route: Route, request: DavRequest): Promise<DavResult> {
    const asked = requestedPropsQualified(request.body);
    const depth = request.depth === "0" ? 0 : 1;
    const p = paths(session.account.username);
    const responses: DavResponse[] = [];
    const add = (href: string, available: PropValues) => responses.push({ href, ...selectProps(available, asked) });

    if (route.kind === "root") {
      add("/dav/", { ...principalProps(session, "RandevuN"), resourcetype: "<D:collection/>" });
    } else if (route.kind === "principal") {
      add(p.principal, principalProps(session, "RandevuN"));
    } else if (route.kind === "home") {
      const list = depth ? await items(session, request.now) : [];
      add(p.home, { resourcetype: "<D:collection/>", displayname: "Takvimler", "current-user-principal": `<D:href>${escapeXml(p.principal)}</D:href>` });
      if (depth) add(p.calendar, collectionProps(session, list));
    } else if (route.kind === "calendar") {
      const list = await items(session, request.now);
      add(p.calendar, collectionProps(session, list));
      if (depth) for (const item of list) add(`${p.calendar}${encodeURIComponent(item.name)}`, itemProps(item, false));
    } else if (route.kind === "item") {
      const item = (await items(session, request.now)).find((i) => i.name === route.name);
      if (!item) return result(404);
      add(`${p.calendar}${encodeURIComponent(item.name)}`, itemProps(item, false));
    }
    return result(207, multistatus(responses), XML);
  }

  async function report(session: Session, route: Route, request: DavRequest): Promise<DavResult> {
    if (route.kind !== "calendar") return result(403);
    const kind = rootElement(request.body);
    const asked = requestedPropsQualified(request.body);
    const withData = asked.length === 0 || asked.some((q) => q.name === "calendar-data");
    const p = paths(session.account.username);
    const list = await items(session, request.now);
    let selected: Item[];
    const missingHrefs: string[] = [];
    if (kind === "calendar-multiget") {
      selected = [];
      for (const href of requestedHrefs(request.body)) {
        const name = decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "");
        const item = list.find((i) => i.name === name);
        if (item) selected.push(item);
        else missingHrefs.push(href);
      }
    } else if (kind === "calendar-query") {
      const { start, end } = requestedTimeRange(request.body);
      selected = list.filter((i) => (!end || i.startAt < end) && (!start || i.endAt > start));
    } else {
      return result(403);
    }
    const responses: DavResponse[] = selected.map((item) => ({
      href: `${p.calendar}${encodeURIComponent(item.name)}`,
      ...selectProps(itemProps(item, withData), asked),
    }));
    const body = multistatus(responses).replace(
      "</D:multistatus>",
      missingHrefs.map((h) => `<D:response><D:href>${escapeXml(h)}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`).join("") + "</D:multistatus>",
    );
    return result(207, body, XML);
  }

  async function put(session: Session, name: string, request: DavRequest): Promise<DavResult> {
    // Appointments are managed in the app; the phone cannot change or move them.
    if (name.startsWith(APPOINTMENT_PREFIX)) return result(403);
    if (Buffer.byteLength(request.body, "utf8") > MAX_ICS_BYTES) return result(413);
    const parsed = parsePhoneEvent(request.body, session.tenant.timezone);
    if (!parsed) return result(400);
    const existing = (await repository.listEvents(session.tenant.tenantContext, session.account.id)).find((e) => e.href === name);
    if (request.ifNoneMatch === "*" && existing) return result(412);
    if (request.ifMatch && request.ifMatch !== "*" && request.ifMatch !== existing?.etag) return result(412);
    const etag = etagOf(request.body);
    await repository.saveEvent(session.tenant.tenantContext, {
      accountId: session.account.id,
      staffId: session.staffId,
      href: name,
      uid: parsed.uid,
      etag,
      ics: request.body,
      title: parsed.title,
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      blocksTime: parsed.blocksTime,
    });
    return result(existing ? 204 : 201, null, { ETag: etag });
  }

  return {
    async handle(request: DavRequest): Promise<DavResult> {
      const method = request.method.toUpperCase();
      if (request.pathname === "/.well-known/caldav") return result(301, null, { Location: "/dav/" });
      const route = routeOf(request.pathname);
      if (!route) return result(404);
      if (method === "OPTIONS") return result(200);

      const auth = await authenticate(request);
      if ("error" in auth) return auth.error;
      const session = auth.session;
      // A path of another account is never served, even with valid credentials.
      if (route.kind !== "root" && route.user !== session.account.username) return result(403);

      switch (method) {
        case "PROPFIND":
          return propfind(session, route, request);
        case "REPORT":
          return report(session, route, request);
        case "PROPPATCH":
          // Clients set colour/order; accepted and not stored.
          return result(207, multistatus([{ href: request.pathname, found: Object.fromEntries(requestedProps(request.body).map((n) => [n, ""])), missing: [] }]), XML);
        case "GET":
        case "HEAD": {
          if (route.kind !== "item") return result(405);
          const item = (await items(session, request.now)).find((i) => i.name === route.name);
          if (!item) return result(404);
          return result(200, method === "HEAD" ? null : item.ics, { "Content-Type": ICS_TYPE, ETag: item.etag });
        }
        case "PUT":
          if (route.kind !== "item") return result(405);
          return put(session, route.name, request);
        case "DELETE": {
          if (route.kind !== "item") return result(403);
          if (route.name.startsWith(APPOINTMENT_PREFIX)) return result(403);
          const deleted = await repository.deleteEvent(session.tenant.tenantContext, session.account.id, route.name);
          return result(deleted ? 204 : 404);
        }
        default:
          return result(405);
      }
    },
  };
}

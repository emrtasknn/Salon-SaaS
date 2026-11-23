import "server-only";

import { createCalDavService } from "../application/caldav-service";
import { createStatusLinkRateLimiter } from "../application/status-link-rate-limit";
import { requestedProps, rootElement } from "../domain/caldav-xml";
import { logInfo } from "../infrastructure/log-redaction";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaPhoneCalendarRepository } from "../persistence/prisma-phone-calendar";
import { createPrismaPublicSalonRepository } from "../persistence/prisma-public-vitrin";
import { checkRateLimit, readClientIp } from "./rate-limit-runtime";

export { isDavPath } from "./dav-path";

/** ADR-045 phase C: answers one CalDAV request. Never logs bodies, credentials or event data. */
export async function handleDavRequest(request: Request, pathname?: string): Promise<Response> {
  const url = new URL(request.url);
  const path = pathname ?? url.pathname;
  const prisma = getPrisma();
  const salons = createPrismaPublicSalonRepository(prisma);
  const limiter = createStatusLinkRateLimiter({ check: checkRateLimit, readClientIp });
  const service = createCalDavService({
    repository: createPrismaPhoneCalendarRepository(prisma),
    resolveTenantBySlug: async (slug) => {
      const salon = await salons.resolveBySlug(slug);
      return salon ? { tenantContext: salon.tenantContext, name: salon.name, timezone: salon.timezone } : null;
    },
    hit: (bucket) => limiter.hit(bucket),
    appUrl: (adminScope) => `${url.origin}${adminScope ? "/admin/calendar" : "/staff/calendar"}`,
  });
  const method = request.method.toUpperCase();
  const body = method === "PUT" || method === "PROPFIND" || method === "REPORT" || method === "PROPPATCH" ? await request.text() : "";
  const result = await service.handle({
    method,
    pathname: path,
    authorization: request.headers.get("authorization"),
    depth: request.headers.get("depth"),
    ifMatch: request.headers.get("if-match"),
    ifNoneMatch: request.headers.get("if-none-match"),
    body,
    now: new Date(),
  });
  // Diagnostics without secrets: no credentials, no body, account name masked in the path.
  logInfo("dav_request", {
    method,
    path: path.replace(/^\/dav\/u\/[^/]+/, "/dav/u/*"),
    status: result.status,
    depth: request.headers.get("depth"),
    props: method === "PROPFIND" || method === "REPORT" ? requestedProps(body).slice(0, 25).join(",") : undefined,
    report: method === "REPORT" ? rootElement(body) : undefined,
    authenticated: request.headers.has("authorization"),
    agent: (request.headers.get("user-agent") ?? "").slice(0, 80),
  });
  // Proxy responses need absolute redirect targets.
  const headers: Record<string, string> = { ...result.headers, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (headers.Location) headers.Location = new URL(headers.Location, url.origin).toString();
  return new Response(result.body, { status: result.status, headers });
}

import "server-only";

import { createCalDavService } from "../application/caldav-service";
import { createStatusLinkRateLimiter } from "../application/status-link-rate-limit";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaPhoneCalendarRepository } from "../persistence/prisma-phone-calendar";
import { createPrismaPublicSalonRepository } from "../persistence/prisma-public-vitrin";
import { checkRateLimit, readClientIp } from "./rate-limit-runtime";

export { isDavPath } from "./dav-path";

/** ADR-045 phase C: answers one CalDAV request. Never logs bodies, credentials or event data. */
export async function handleDavRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
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
    pathname: url.pathname,
    authorization: request.headers.get("authorization"),
    depth: request.headers.get("depth"),
    ifMatch: request.headers.get("if-match"),
    ifNoneMatch: request.headers.get("if-none-match"),
    body,
    now: new Date(),
  });
  // Proxy responses need absolute redirect targets.
  const headers: Record<string, string> = { ...result.headers, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (headers.Location) headers.Location = new URL(headers.Location, url.origin).toString();
  return new Response(result.body, { status: result.status, headers });
}

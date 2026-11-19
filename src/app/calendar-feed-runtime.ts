import "server-only";

import { createCalendarFeedService } from "../application/calendar-feed";
import { createStatusLinkRateLimiter } from "../application/status-link-rate-limit";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaCalendarFeedRepository } from "../persistence/prisma-calendar-feed";
import { createPrismaPublicSalonRepository } from "../persistence/prisma-public-vitrin";
import { checkRateLimit, readClientIp } from "./rate-limit-runtime";

/** Server wiring for the ADR-045 calendar feed (route + settings actions). `origin` = this app's URL. */
export function calendarFeedService(origin: string | null) {
  const prisma = getPrisma();
  const salons = createPrismaPublicSalonRepository(prisma);
  // Same IP limiter adapter as the status link, with the feed buckets.
  const limiter = createStatusLinkRateLimiter({ check: checkRateLimit, readClientIp });
  return createCalendarFeedService({
    repository: createPrismaCalendarFeedRepository(prisma),
    resolveTenantBySlug: async (slug) => {
      const salon = await salons.resolveBySlug(slug);
      return salon ? { tenantContext: salon.tenantContext, name: salon.name } : null;
    },
    hit: (bucket) => limiter.hit(bucket),
    appUrl: (scope) => (origin ? `${origin}${scope === "TENANT_ALL" ? "/admin/calendar" : "/staff/calendar"}` : null),
  });
}

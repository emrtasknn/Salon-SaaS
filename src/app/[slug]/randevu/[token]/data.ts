import "server-only";
import {
  createCustomerAppointmentStatus,
  type CustomerAppointmentLoadResult,
} from "../../../../application/customer-appointment-status";
import { createStatusLinkRateLimiter } from "../../../../application/status-link-rate-limit";
import { checkRateLimit, readClientIp } from "../../../rate-limit-runtime";
import { getPrisma } from "../../../../infrastructure/prisma-runtime";
import { logInfo } from "../../../../infrastructure/log-redaction";
import { createPrismaAppointmentAccessTokenRepository } from "../../../../persistence/prisma-appointment-access-token";
import { createPrismaPublicSalonRepository } from "../../../../persistence/prisma-public-vitrin";

/** Server-side wiring for the WP-06 customer status link (shared by page data and the cancel action). */
export function customerAppointmentStatusService() {
  const prisma = getPrisma();
  const salons = createPrismaPublicSalonRepository(prisma);
  return createCustomerAppointmentStatus({
    resolveTenantBySlug: (slug) => salons.resolveBySlug(slug),
    repository: createPrismaAppointmentAccessTokenRepository(prisma),
    // WP-05 persistent IP limiter: status.view 30/10 min, status.miss 10/10 min (skipped without a trusted IP).
    limiter: createStatusLinkRateLimiter({ check: checkRateLimit, readClientIp }),
    // Redacted console.info; context never includes the token.
    logCancelled: (event) => logInfo("customer_appointment_cancelled", event),
  });
}

export async function loadCustomerAppointment(slug: string, token: string): Promise<CustomerAppointmentLoadResult> {
  return customerAppointmentStatusService().view(slug, token);
}

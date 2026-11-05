import "server-only";
import {
  CUSTOMER_NOTICE, WHATSAPP_OPTIN, customerNoticeHash, isLegalReady, renderFullNotice, renderShortNotice, renderWhatsAppOptIn,
  whatsAppOptInHash,
} from "../../domain/legal-notice";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { createPrismaPublicSalonRepository } from "../../persistence/prisma-public-vitrin";
import type { FullNoticeView, PublicLegalView } from "../legal-consent-contract";

// WP-10: server-only loaders for the public notice texts. The tenant is resolved from the slug
// on the server; raw tenant legal fields are never returned, only the rendered texts.

const MAX_SLUG_LENGTH = 100;

async function resolveTenant(slug: unknown) {
  if (typeof slug !== "string") return null;
  const normalized = slug.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_SLUG_LENGTH) return null;
  return createPrismaPublicSalonRepository(getPrisma()).resolveBySlug(normalized);
}

export async function loadPublicLegalView(slug: string): Promise<PublicLegalView | null> {
  const tenant = await resolveTenant(slug);
  if (!tenant) return null;
  const optIn = renderWhatsAppOptIn(tenant);
  return {
    ready: isLegalReady(tenant),
    noticeVersion: CUSTOMER_NOTICE.version,
    // Same rendering + sha256 as the booking tx; the server rejects a mismatch as NOTICE_STALE.
    noticeHash: customerNoticeHash(tenant),
    shortNotice: renderShortNotice(tenant),
    fullNoticePath: `/${encodeURIComponent(slug.trim().toLowerCase())}/aydinlatma`,
    optInVersion: WHATSAPP_OPTIN.version,
    optInHash: whatsAppOptInHash(tenant),
    optInLabel: optIn.label,
    optInHelp: optIn.help,
  };
}

export async function loadFullNotice(slug: string): Promise<FullNoticeView | null> {
  const tenant = await resolveTenant(slug);
  if (!tenant) return null;
  return {
    salonName: tenant.name,
    version: CUSTOMER_NOTICE.version,
    text: renderFullNotice(tenant),
    draft: CUSTOMER_NOTICE.draft,
  };
}

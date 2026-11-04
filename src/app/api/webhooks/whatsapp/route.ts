import { NextResponse } from "next/server";
import type { TenantId } from "../../../../domain/tenant-context";
import { logInfo } from "../../../../infrastructure/log-redaction";
import { parseMetaWebhookStatuses, verifyMetaWebhookSignature, type MetaWebhookStatus } from "../../../../infrastructure/meta-whatsapp-webhook";
import { getPrisma } from "../../../../infrastructure/prisma-runtime";
import {
  applyWhatsAppWebhookStatuses,
  resolveWhatsAppDeliveryTenantId,
  resolveWhatsAppTenantId,
} from "../../../../persistence/prisma-whatsapp-webhook";

const MAX_LOGGED_UNRESOLVED = 10;

// Only a short suffix is logged so a wamid can be correlated without being stored in full.
function maskProviderMessageId(value: string): string {
  return value.length <= 6 ? "***" : `***${value.slice(-6)}`;
}

function push<K>(map: Map<K, MetaWebhookStatus[]>, key: K, status: MetaWebhookStatus) {
  const existing = map.get(key);
  if (existing) existing.push(status);
  else map.set(key, [status]);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode !== "subscribe" || !challenge || !expectedToken || token !== expectedToken) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret || !verifyMetaWebhookSignature({ rawBody, signatureHeader: signature, appSecret })) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const statuses = parseMetaWebhookStatuses(payload);
  const prisma = getPrisma();
  // Shared platform sender (WP-02b/WP-02c). Read from server config, same env as the outbound provider.
  const sharedPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;

  const sharedStatuses: MetaWebhookStatus[] = [];
  const groupedByPhone = new Map<string, MetaWebhookStatus[]>();
  for (const status of statuses) {
    if (sharedPhoneNumberId && status.phoneNumberId === sharedPhoneNumberId) sharedStatuses.push(status);
    else push(groupedByPhone, status.phoneNumberId, status);
  }

  let updatedCount = 0;
  let unresolvedCount = 0;
  const unresolvedShared: MetaWebhookStatus[] = [];

  // WP-02c: shared sender → resolve each status by wamid; exactly one tenant or nothing.
  // A NULL here must never fall back to the phone-number resolver below.
  if (sharedStatuses.length > 0) {
    const tenantByMessageId = new Map<string, TenantId | null>();
    const groupedByTenant = new Map<TenantId, MetaWebhookStatus[]>();
    for (const status of sharedStatuses) {
      let tenantId = tenantByMessageId.get(status.providerMessageId);
      if (tenantId === undefined) {
        tenantId = await resolveWhatsAppDeliveryTenantId(prisma, status.providerMessageId);
        tenantByMessageId.set(status.providerMessageId, tenantId);
      }
      if (!tenantId) {
        unresolvedShared.push(status);
        continue;
      }
      push(groupedByTenant, tenantId, status);
    }
    unresolvedCount += unresolvedShared.length;

    for (const [tenantId, tenantStatuses] of groupedByTenant) {
      updatedCount += await applyWhatsAppWebhookStatuses(prisma, { tenantId }, tenantStatuses);
    }
  }

  // W11.6: any other sender → phone_number_id → WhatsAppIntegration → tenant.
  let unresolvedIntegration = 0;
  for (const [phoneNumberId, phoneStatuses] of groupedByPhone) {
    const tenantId = await resolveWhatsAppTenantId(prisma, phoneNumberId);
    if (!tenantId) {
      unresolvedIntegration += phoneStatuses.length;
      continue;
    }

    updatedCount += await applyWhatsAppWebhookStatuses(
      prisma,
      { tenantId },
      phoneStatuses,
    );
  }
  unresolvedCount += unresolvedIntegration;

  if (unresolvedCount > 0) {
    logInfo("whatsapp_webhook_status_unresolved", {
      sharedSenderUnresolved: unresolvedShared.length,
      integrationUnresolved: unresolvedIntegration,
      samples: unresolvedShared.slice(0, MAX_LOGGED_UNRESOLVED).map(status => ({
        status: status.status,
        messageRef: maskProviderMessageId(status.providerMessageId),
      })),
    });
  }

  return NextResponse.json({
    accepted: true,
    statusCount: statuses.length,
    updatedCount,
    unresolvedCount,
  });
}

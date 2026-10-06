import { NextResponse } from "next/server";
import { parseMetaWebhookStatuses, verifyMetaWebhookSignature } from "../../../../infrastructure/meta-whatsapp-webhook";
import { getPrisma } from "../../../../infrastructure/prisma-runtime";
import { applyWhatsAppWebhookStatuses, resolveWhatsAppTenantId } from "../../../../persistence/prisma-whatsapp-webhook";

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
  const grouped = new Map<string, typeof statuses[number][]>();

  for (const status of statuses) {
    const existing = grouped.get(status.phoneNumberId);
    if (existing) existing.push(status);
    else grouped.set(status.phoneNumberId, [status]);
  }

  let updatedCount = 0;
  let unresolvedCount = 0;

  for (const [phoneNumberId, phoneStatuses] of grouped) {
    const tenantId = await resolveWhatsAppTenantId(prisma, phoneNumberId);
    if (!tenantId) {
      unresolvedCount += phoneStatuses.length;
      continue;
    }

    updatedCount += await applyWhatsAppWebhookStatuses(
      prisma,
      { tenantId },
      phoneStatuses,
    );
  }

  return NextResponse.json({
    accepted: true,
    statusCount: statuses.length,
    updatedCount,
    unresolvedCount,
  });
}

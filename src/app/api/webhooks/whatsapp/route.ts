import { NextResponse } from "next/server";
import { parseMetaWebhookStatuses, verifyMetaWebhookSignature } from "../../../../infrastructure/meta-whatsapp-webhook";

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

  const payload = JSON.parse(rawBody) as unknown;
  const statuses = parseMetaWebhookStatuses(payload);

  // Status persistence is intentionally not performed here until provider-message
  // lookup -> tenant resolution is wired. A verified event must never infer tenant
  // ownership from client-provided payload fields.
  return NextResponse.json({ accepted: true, statusCount: statuses.length });
}

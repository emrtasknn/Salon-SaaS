import "server-only";
import { createNotificationService } from "../application/notification-service";
import { createMetaWhatsAppProvider } from "../infrastructure/notifications";
import { createWebPushProvider } from "../infrastructure/web-push-provider";
import { createPrismaNotificationRepository } from "../persistence/prisma-notification";
import { createPrismaPushNotificationRepository } from "../persistence/prisma-push-subscription";
import type { TenantContext } from "../domain/tenant-context";
import type { NotificationEventType } from "../domain/notification";
import { readVapidConfig } from "../domain/web-push";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { logError } from "../infrastructure/log-redaction";

// Node runtime only: web-push needs node:https / node:crypto (never import from Edge code).

function provider() {
  const accessToken=process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion=process.env.WHATSAPP_API_VERSION;
  const templatesJson=process.env.WHATSAPP_TEMPLATES_JSON;
  if(!accessToken||!phoneNumberId||!apiVersion||!templatesJson) return null;
  let templates: Record<string,{name:string;languageCode:string}>;
  try { templates=JSON.parse(templatesJson) as Record<string,{name:string;languageCode:string}>; } catch { return null; }
  return createMetaWhatsAppProvider({accessToken,phoneNumberId,apiVersion,templates});
}

function webPushProvider() {
  const config=readVapidConfig(process.env);
  if(!config&&(process.env.WEB_PUSH_VAPID_PUBLIC_KEY||process.env.WEB_PUSH_VAPID_PRIVATE_KEY||process.env.WEB_PUSH_VAPID_SUBJECT)) {
    logError("web_push_config_invalid",{errorCode:"WEB_PUSH_VAPID_CONFIG_INVALID"});
  }
  return config ? createWebPushProvider(config) : null;
}

/** `eventKey`: one key per occurrence for repeatable events (APPOINTMENT_RESCHEDULED); omit otherwise. */
export async function publishAppointmentNotification(tenantContext:TenantContext,appointmentId:string,eventType:NotificationEventType,eventKey?:string) {
  // Channels are configured independently; NOT_CONFIGURED only when neither is available.
  const p=provider();
  const push=webPushProvider();
  if(!p&&!push) return {status:"NOT_CONFIGURED" as const};
  try {
    const prisma=getPrisma();
    return await createNotificationService({
      repository:createPrismaNotificationRepository(prisma),
      provider:p,
      webPush:push?{repository:createPrismaPushNotificationRepository(prisma),provider:push}:null,
    }).publish(tenantContext,appointmentId,eventType,eventKey);
  } catch {
    return {status:"FAILED" as const};
  }
}

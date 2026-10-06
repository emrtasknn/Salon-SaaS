import "server-only";
import { createNotificationService } from "../application/notification-service";
import { createMetaWhatsAppProvider } from "../infrastructure/notifications";
import { createPrismaNotificationRepository } from "../persistence/prisma-notification";
import type { TenantContext } from "../domain/tenant-context";
import type { NotificationEventType } from "../domain/notification";
import { getPrisma } from "../infrastructure/prisma-runtime";

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

export async function publishAppointmentNotification(tenantContext:TenantContext,appointmentId:string,eventType:NotificationEventType) {
  const p=provider();
  if(!p) return {status:"NOT_CONFIGURED" as const};
  try {
    return await createNotificationService({repository:createPrismaNotificationRepository(getPrisma()),provider:p}).publish(tenantContext,appointmentId,eventType);
  } catch {
    return {status:"FAILED" as const};
  }
}

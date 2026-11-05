"use server";
import type { CustomerCancelResult } from "../../../../application/customer-appointment-status";
import type { StopWhatsAppResult } from "../../../legal-consent-contract";
import { customerAppointmentStatusService } from "./data";

/** Customer self-cancel. Tenant comes from the slug server-side; the token only selects the appointment. */
export async function cancelAppointmentByToken(slug: string, token: string): Promise<CustomerCancelResult> {
  return customerAppointmentStatusService().cancel(slug, token);
}

/**
 * WP-10: customer WhatsApp opt-out from the status link. Same token resolution and status-link
 * rate limiter as cancel; tenant from the slug server-side. Idempotent.
 */
export async function stopWhatsAppByToken(slug: string, token: string): Promise<StopWhatsAppResult> {
  return customerAppointmentStatusService().stopWhatsApp(slug, token);
}

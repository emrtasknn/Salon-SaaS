"use server";
import type { CustomerCancelResult } from "../../../../application/customer-appointment-status";
import { customerAppointmentStatusService } from "./data";

/** Customer self-cancel. Tenant comes from the slug server-side; the token only selects the appointment. */
export async function cancelAppointmentByToken(slug: string, token: string): Promise<CustomerCancelResult> {
  return customerAppointmentStatusService().cancel(slug, token);
}

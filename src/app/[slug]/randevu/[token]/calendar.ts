import "server-only";
import { headers } from "next/headers";
import type { CustomerAppointmentView } from "../../../../application/customer-appointment-status";
import { appointmentCalendarEvent, type CalendarEvent } from "../../../../domain/calendar-event";

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** Absolute status page URL for the current request host (written into the customer's own calendar). */
async function statusPageUrl(slug: string, token: string): Promise<string> {
  const requestHeaders = await headers();
  const rawHost = requestHeaders.get("host") ?? "";
  const host = HOST_PATTERN.test(rawHost) ? rawHost : "localhost";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : isLocal ? "http" : "https";
  return `${proto}://${host}/${encodeURIComponent(slug)}/randevu/${encodeURIComponent(token)}`;
}

/** Calendar event for an eligible appointment, or null (not open / already started). */
export async function customerCalendarEvent(
  slug: string,
  token: string,
  appointment: CustomerAppointmentView,
): Promise<CalendarEvent | null> {
  const { status } = appointment;
  if (!appointment.calendarEligible || (status !== "PENDING" && status !== "CONFIRMED")) return null;
  return appointmentCalendarEvent({
    calendarUid: appointment.calendarUid,
    serviceName: appointment.serviceName,
    salonName: appointment.salonName,
    staffName: appointment.staffName,
    salonAddress: appointment.salonAddress,
    startAtIso: appointment.startAtIso,
    endAtIso: appointment.endAtIso,
    status,
    statusUrl: await statusPageUrl(slug, token),
  });
}

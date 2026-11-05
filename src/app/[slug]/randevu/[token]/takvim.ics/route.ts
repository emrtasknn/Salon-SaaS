import { buildIcsCalendar } from "../../../../../domain/calendar-event";
import { loadCustomerAppointment } from "../data";
import { customerCalendarEvent } from "../calendar";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

function empty(status: 404 | 429) {
  return new Response(null, { status, headers: PRIVATE_HEADERS });
}

/**
 * Apple Calendar / iCalendar download for the customer status link. Same slug+token
 * resolution, tenant scoping and rate limiting as the status page (loadCustomerAppointment).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const result = await loadCustomerAppointment(slug, token);
  if (result.status === "RATE_LIMITED") return empty(429);
  if (result.status !== "ok") return empty(404);

  const event = await customerCalendarEvent(slug, token, result.appointment);
  if (!event) return empty(404);

  return new Response(buildIcsCalendar(event, new Date()), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="randevu.ics"',
    },
  });
}

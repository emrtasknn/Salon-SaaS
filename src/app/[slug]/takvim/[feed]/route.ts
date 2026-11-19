import { calendarFeedService } from "../../../calendar-feed-runtime";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

/**
 * ADR-045 private calendar subscription (Apple/Google Calendar poll this URL). The token in the
 * path is the only credential: tenant from the slug, holder from the token row, role and staff
 * state re-checked on every fetch. Unknown, revoked or malformed tokens get a bare 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; feed: string }> }) {
  const { slug, feed } = await params;
  const result = await calendarFeedService(new URL(request.url).origin).render(slug, feed, new Date());
  if (result.status === "RATE_LIMITED") return new Response(null, { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": "600" } });
  if (result.status !== "ok") return new Response(null, { status: 404, headers: PRIVATE_HEADERS });
  return new Response(result.body, {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="randevular.ics"',
    },
  });
}

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatBadgeCount, InAppNotifications, NotificationItem } from "./in-app-notifications";
import type { InAppNotificationView } from "../application/in-app-notifications";

const reload = async () => ({ status: "UNAUTHORIZED" }) as InAppNotificationView;

function view(pendingCount: number, pending: unknown[] = []) {
  return { status: "ok", pendingCount, pending, recent: [] } as unknown as InAppNotificationView;
}

describe("notification bell", () => {
  it("caps the badge at 9+", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(9)).toBe("9");
    expect(formatBadgeCount(10)).toBe("9+");
  });

  it("renders a bell button with the exact count in its accessible name", () => {
    const html = renderToStaticMarkup(<InAppNotifications initialData={view(12)} reload={reload} href="/admin/calendar" />);
    expect(html).toContain('aria-label="Bildirimler: 12 onay bekleyen randevu"');
    expect(html).toContain('data-testid="notification-count"');
    expect(html).toContain(">9+<");
    expect(html).not.toContain(">Bildirimler<");
    expect(html).toContain("size-11");
  });

  it("hides the badge when nothing is pending", () => {
    const html = renderToStaticMarkup(<InAppNotifications initialData={view(0)} reload={reload} href="/staff/appointments" />);
    expect(html).toContain("onay bekleyen randevu yok");
    expect(html).not.toContain("notification-count");
  });

  it("links each item to its appointment and colors the status chip", () => {
    const item = {
      appointmentId: "appt_1", kind: "PENDING_REQUEST", status: "CANCELLED",
      startAt: "2026-11-10T07:00:00.000Z", updatedAt: "2026-11-09T07:00:00.000Z",
      serviceName: "Kesim", staffDisplayName: "Ayşe",
    } as const;
    const html = renderToStaticMarkup(<ul><NotificationItem item={item} href="/staff" onNavigate={() => {}} /></ul>);
    expect(html).toContain('href="/staff?date=2026-11-10&amp;appointment=appt_1"');
    expect(html).toContain("bg-status-cancelled-bg text-status-cancelled");
    expect(html).toContain(">İptal<");
  });
});

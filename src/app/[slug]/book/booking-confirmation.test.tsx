import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingConfirmation } from "./booking-confirmation";
import { initialStaffId } from "./form";

describe("initialStaffId", () => {
  it("defaults to \"Fark etmez\" (never the first person) when the customer has a choice", () => {
    expect(initialStaffId([{ id: "a", displayName: "Ayşe" }, { id: "b", displayName: "Burak" }])).toBe("any");
  });

  it("preselects the only staff member", () => {
    expect(initialStaffId([{ id: "a", displayName: "Ayşe" }])).toBe("a");
  });

  it("returns empty when there is no staff", () => {
    expect(initialStaffId([])).toBe("");
  });
});

describe("BookingConfirmation", () => {
  const summary = {
    serviceName: "Saç kesimi",
    staffName: "Ayşe",
    startAtIso: "2026-11-07T08:00:00.000Z",
    timeZone: "Europe/Istanbul",
    statusUrl: "https://example.test/r/abc",
  };

  it("shows the result first with the booking details in salon time", () => {
    const html = renderToStaticMarkup(<BookingConfirmation summary={summary} onNewBooking={() => {}} />);
    expect(html).toContain("Randevu talebiniz alındı");
    expect(html).toContain("Saç kesimi");
    expect(html).toContain("Ayşe");
    expect(html).toContain("11:00");
    expect(html).toContain("https://example.test/r/abc");
    expect(html).toContain("Yeni randevu al");
  });

  it("hides the link block when there is no status link", () => {
    const html = renderToStaticMarkup(<BookingConfirmation summary={{ ...summary, statusUrl: "" }} onNewBooking={() => {}} />);
    expect(html).not.toContain("Randevu bağlantınız");
  });
});

describe("PublicBookingForm steps", () => {
  const legal = {
    ready: true, noticeVersion: "v", noticeHash: "h", optInVersion: "o", optInHash: "oh",
    optInLabel: "WhatsApp", optInHelp: "help", shortNotice: "notice", fullNoticePath: "/x/aydinlatma",
  } as never;
  const base = {
    slug: "salon", legal, services: [{ id: "s1", name: "Saç kesimi", durationMinutes: 30, bufferMinutes: 0 }],
    staff: [{ id: "a", displayName: "Ayşe" }, { id: "b", displayName: "Burak" }],
    timeZone: "Europe/Istanbul", minDate: "2026-11-07",
  };

  it("opens on the service list with a disabled Devam until a service is chosen", async () => {
    const { PublicBookingForm } = await import("./form");
    const html = renderToStaticMarkup(<PublicBookingForm {...base} initialServiceId="" />);
    expect(html).toContain("Adım 1 / 3");
    expect(html).toContain("Hizmet seçin");
    expect(html).toContain("Saç kesimi");
    expect(html).toContain("Bir hizmet seçin");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Devam/);
  });

  it("starts at staff and time with \"Fark etmez\" selected, not the first staff member", async () => {
    const { PublicBookingForm } = await import("./form");
    const html = renderToStaticMarkup(<PublicBookingForm {...base} initialServiceId="s1" />);
    expect(html).toContain("Adım 2 / 3");
    expect(html).toContain("Uzman ve saat");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Fark etmez/);
    expect(html).not.toMatch(/aria-pressed="true"[^>]*>Ayşe/);
    expect(html).toContain("Uygun saatler kontrol ediliyor");
  });

  it("explains an empty service list", async () => {
    const { PublicBookingForm } = await import("./form");
    const html = renderToStaticMarkup(<PublicBookingForm {...base} services={[]} initialServiceId="" />);
    expect(html).toContain("henüz online randevuya açık bir hizmet eklemedi");
  });
});

describe("PublicBookingForm catalog (#189)", () => {
  it("groups services under category headings and shows the price, not the buffer", async () => {
    const { PublicBookingForm } = await import("./form");
    const html = renderToStaticMarkup(
      <PublicBookingForm
        slug="salon"
        legal={{ ready: true, noticeVersion: "v", noticeHash: "h", optInVersion: "o", optInHash: "oh", optInLabel: "W", optInHelp: "h", shortNotice: "n", fullNoticePath: "/x" } as never}
        services={[{ id: "s1", name: "Kesim", durationMinutes: 30, bufferMinutes: 10, categoryId: "c1", priceMinor: 45000, priceIsFrom: false }]}
        categories={[{ id: "c1", name: "Saç", sortOrder: 0 }]}
        staff={[{ id: "a", displayName: "Ayşe" }]}
        timeZone="Europe/Istanbul"
        minDate="2026-11-07"
        initialServiceId=""
      />,
    );
    expect(html).toContain(">Saç<");
    expect(html).toContain("Kesim");
    expect(html).toMatch(/450/);
    expect(html).not.toContain("hazırlık");
  });
});

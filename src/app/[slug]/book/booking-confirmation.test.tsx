import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingConfirmation } from "./booking-confirmation";
import { initialStaffId } from "./form";

describe("initialStaffId", () => {
  it("does not pick a staff member when the customer has a choice", () => {
    expect(initialStaffId([{ id: "a", displayName: "Ayşe" }, { id: "b", displayName: "Burak" }])).toBe("");
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

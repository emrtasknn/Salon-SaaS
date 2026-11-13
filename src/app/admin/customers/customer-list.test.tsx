import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerList } from "./customer-list";

const customers = [
  { id: "c1", displayName: "Zeynep Kaya", email: null, phone: "+905050626252", appointmentCount: 3, lastAppointmentAt: "2026-11-06T09:00:00.000Z" },
  { id: "c2", displayName: "Mert Demir", email: "mert@example.com", phone: null, appointmentCount: 0, lastAppointmentAt: null },
];

describe("CustomerList", () => {
  const html = renderToStaticMarkup(<CustomerList customers={customers} now={new Date("2026-11-10T09:00:00.000Z")} />);

  it("uses the shared inset group instead of raw borders", () => {
    expect(html).toContain("inset-group");
    expect(html.match(/inset-row/g)).toHaveLength(2);
    expect(html).not.toMatch(/class="[^"]*\bdivide-y\b/);
    expect(html).not.toMatch(/class="[^"]*\bborder\b/);
  });

  it("formats the phone and never prints placeholders for missing contact details", () => {
    expect(html).toContain("+90 505 062 62 52");
    expect(html).not.toContain("E-posta yok");
    expect(html).not.toContain("Telefon yok");
  });

  it("falls back to the e-mail when there is no phone", () => {
    expect(html).toContain("mert@example.com");
  });

  it("shows the visit count and the last visit as a short date", () => {
    expect(html).toContain("3 randevu");
    expect(html).toContain("6 Kas");
    expect(html).toContain("Henüz randevu yok");
  });

  it("links each row to the customer", () => {
    expect(html).toContain('href="/admin/customers?id=c1"');
  });
});

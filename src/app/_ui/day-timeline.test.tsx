import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DayTimeline, formatPeriod, parseStoredView, ViewSwitch } from "./day-timeline";
import { WeekView } from "./week-view";
import { countByDay, MonthView } from "./month-view";

const noop = () => {};

describe("DayTimeline (vertical)", () => {
  const html = renderToStaticMarkup(
    <DayTimeline
      date="2026-11-05"
      rows={[
        { id: "s1", label: "Ayşe" },
        { id: "s2", label: "Mehmet" },
      ]}
      items={[
        { id: "a1", rowId: "s1", startAt: "2026-11-05T07:00:00.000Z", endAt: "2026-11-05T07:30:00.000Z", status: "PENDING", customer: "Can", service: "Kesim" },
        { id: "a2", rowId: "s1", startAt: "2026-11-05T07:15:00.000Z", endAt: "2026-11-05T07:45:00.000Z", status: "CANCELLED", customer: "Ece", service: "Fön" },
        { id: "a3", rowId: "s2", startAt: "2026-11-05T09:00:00.000Z", endAt: "2026-11-05T10:00:00.000Z", status: "CONFIRMED", customer: "Deniz", service: "Boya" },
      ]}
      onSelect={noop}
    />,
  );

  it("renders each appointment as a button whose accessible name carries time and status text", () => {
    expect(html).toContain('aria-label="10:00–10:30, Can, Kesim, Bekliyor. Ayrıntıları aç"');
    expect(html).toContain('aria-label="10:15–10:45, Ece, Fön, İptal. Ayrıntıları aç"');
    expect(html.match(/<button type="button"/g)?.length).toBe(3);
  });

  it("has one column per staff member and the default 08:00–21:00 hour labels", () => {
    expect(html).toContain('aria-label="Ayşe randevuları"');
    expect(html).toContain('aria-label="Mehmet randevuları"');
    expect(html).toContain(">08:00<");
    expect(html).toContain(">21:00<");
  });

  it("places bars on the Y axis (88px per hour) and splits overlaps into side-by-side lanes", () => {
    // 10:00 is two hours after 08:00: 10px padding + 176px + 1px gap.
    expect(html).toContain("top:187px");
    expect(html).toContain("width:calc(50% - 4px)");
    expect(html).toContain("left:calc(50% + 2px)");
    // The 12:00–13:00 bar in the other column keeps the full width.
    expect(html).toContain("width:calc(100% - 4px)");
  });
});

describe("WeekView", () => {
  const items = [
    { id: "w1", staffId: "s1", staffName: "Ayşe", startAt: "2026-11-02T07:00:00.000Z", endAt: "2026-11-02T07:30:00.000Z", status: "CONFIRMED", customer: "Can", service: "Kesim" },
    { id: "w2", staffId: "s2", staffName: "Mehmet", startAt: "2026-11-08T08:00:00.000Z", endAt: "2026-11-08T09:00:00.000Z", status: "PENDING", customer: "Ece", service: "Boya" },
  ];

  it("shows Mon–Sun columns with staff filter chips for the admin", () => {
    const html = renderToStaticMarkup(<WeekView date="2026-11-05" items={items} perStaffColors onSelect={noop} onOpenDay={noop} />);
    expect(html).toContain('aria-label="Pzt 2 randevuları"');
    expect(html).toContain('aria-label="Paz 8 randevuları"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Tümü/);
    expect(html).toContain("Mehmet");
    expect(html).toContain('aria-label="10:00–10:30, Can, Ayşe · Kesim, Onaylandı. Ayrıntıları aç"');
  });

  it("has no filter chips in the staff calendar", () => {
    const html = renderToStaticMarkup(<WeekView date="2026-11-05" items={items.slice(0, 1)} perStaffColors={false} onSelect={noop} onOpenDay={noop} />);
    expect(html).not.toContain("Tümü");
    expect(html).toContain('aria-label="10:00–10:30, Can, Kesim, Onaylandı. Ayrıntıları aç"');
  });
});

describe("MonthView", () => {
  it("labels each day with its count, status breakdown and closure", () => {
    const html = renderToStaticMarkup(
      <MonthView
        date="2026-11-05"
        items={[
          { startAt: "2026-11-10T07:00:00.000Z", status: "PENDING" },
          { startAt: "2026-11-10T08:00:00.000Z", status: "CONFIRMED" },
          { startAt: "2026-11-10T09:00:00.000Z", status: "CONFIRMED" },
        ]}
        closedDates={new Set(["2026-11-11"])}
        onOpenDay={noop}
      />,
    );
    expect(html).toContain("10 Kasım 2026 Salı, 3 randevu: 1 bekliyor, 2 onaylandı. Gün görünümünü aç");
    expect(html).toContain("11 Kasım 2026 Çarşamba, kapalı gün, randevu yok. Gün görünümünü aç");
    expect(html.match(/<li /g)?.length).toBe(42);
  });

  it("counts by Istanbul local date", () => {
    const counts = countByDay([{ startAt: "2026-11-10T21:30:00.000Z", status: "PENDING" }]);
    expect(counts.get("2026-11-11")?.total).toBe(1);
  });
});

describe("ViewSwitch", () => {
  it("offers Gün | Hafta | Ay | Liste and marks the selected view with aria-pressed", () => {
    const html = renderToStaticMarkup(<ViewSwitch view="week" onChange={noop} />);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Gün/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Hafta/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Ay/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Liste/);
  });

  it("maps stored values, including the earlier timeline choice, to a view", () => {
    expect(parseStoredView("timeline")).toBe("day");
    expect(parseStoredView("list")).toBe("list");
    expect(parseStoredView("month")).toBe("month");
    expect(parseStoredView("bogus")).toBe("day");
    expect(parseStoredView(null)).toBe("day");
  });
});

describe("formatPeriod", () => {
  it("names the visible period", () => {
    expect(formatPeriod("day", "2026-11-05")).toBe("5 Kasım 2026 Perşembe");
    expect(formatPeriod("week", "2026-11-05")).toBe("2–8 Kasım 2026");
    expect(formatPeriod("week", "2026-12-30")).toBe("28 Aralık 2026–3 Ocak 2027");
    expect(formatPeriod("month", "2026-11-05")).toBe("Kasım 2026");
  });
});

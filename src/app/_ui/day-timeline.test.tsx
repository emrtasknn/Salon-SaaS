import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DayTimeline, ViewSwitch } from "./day-timeline";

const noop = () => {};

describe("DayTimeline", () => {
  const html = renderToStaticMarkup(
    <DayTimeline
      date="2026-11-05"
      rows={[{ id: "s1", label: "Ayşe" }]}
      items={[
        { id: "a1", rowId: "s1", startAt: "2026-11-05T07:00:00.000Z", endAt: "2026-11-05T07:30:00.000Z", status: "PENDING", customer: "Can", service: "Kesim" },
        { id: "a2", rowId: "s1", startAt: "2026-11-05T07:15:00.000Z", endAt: "2026-11-05T07:45:00.000Z", status: "CANCELLED", customer: "Ece", service: "Fön" },
      ]}
      onSelect={noop}
    />,
  );

  it("renders each appointment as a button whose accessible name carries time and status text", () => {
    expect(html).toContain('aria-label="10:00–10:30, Can, Kesim, Bekliyor. Ayrıntıları aç"');
    expect(html).toContain('aria-label="10:15–10:45, Ece, Fön, İptal. Ayrıntıları aç"');
    expect(html.match(/<button type="button"/g)?.length).toBe(2);
  });

  it("shows the staff row and the default 08:00–21:00 hour labels", () => {
    expect(html).toContain("Ayşe");
    expect(html).toContain("08:00");
    expect(html).toContain("20:00");
    expect(html).not.toContain(">21:00<");
  });

  it("stacks overlapping appointments in separate lanes (two-lane row height)", () => {
    expect(html).toContain("height:112px");
  });
});

describe("ViewSwitch", () => {
  it("marks the selected view with aria-pressed", () => {
    const html = renderToStaticMarkup(<ViewSwitch view="timeline" onChange={noop} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Çizelge/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Liste/);
  });
});

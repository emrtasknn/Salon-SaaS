import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/haptics", () => ({ haptic: () => {} }));

import { DayAgenda, groupAgenda, WeekAgenda } from "./agenda-list";

// Istanbul is UTC+3.
const item = (id: string, startAt: string, status = "CONFIRMED") => ({
  id,
  startAt,
  endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
  status,
  customer: `Müşteri ${id}`,
  service: "Saç kesimi",
});
const items = [
  item("b", "2026-11-19T11:00:00.000Z"),
  item("a", "2026-11-19T07:00:00.000Z", "PENDING"),
  item("c", "2026-11-20T22:30:00.000Z"), // 01:30 on the 21st locally
];
const noop = () => {};

describe("groupAgenda", () => {
  it("groups by local day in time order", () => {
    expect(groupAgenda(items).map((g) => [g.date, g.rows.map((r) => r.id)])).toEqual([
      ["2026-11-19", ["a", "b"]],
      ["2026-11-21", ["c"]],
    ]);
  });
  it("keeps only pending requests with the pending filter", () => {
    expect(groupAgenda(items, "pending").flatMap((g) => g.rows.map((r) => r.id))).toEqual(["a"]);
  });
});

describe("agenda components", () => {
  it("lists the selected day under the month grid with a day-view link", () => {
    const html = renderToStaticMarkup(<DayAgenda date="2026-11-19" items={items} onSelect={noop} onOpenDay={noop} />);
    expect(html).toContain("Müşteri a");
    expect(html).toContain("Müşteri b");
    expect(html).not.toContain("Müşteri c");
    expect(html).toContain("Gün görünümü");
    expect(html).toContain("Bekliyor");
  });
  it("shows the empty text for a free day", () => {
    const html = renderToStaticMarkup(<DayAgenda date="2026-11-22" items={items} onSelect={noop} onOpenDay={noop} emptyText="Boş gün" />);
    expect(html).toContain("Boş gün");
  });
  it("groups the week with filter chips and a pending count", () => {
    const html = renderToStaticMarkup(<WeekAgenda date="2026-11-19" items={items} onSelect={noop} />);
    expect(html).toContain('data-agenda-day="2026-11-19"');
    expect(html).toContain('data-agenda-day="2026-11-21"');
    expect(html).toContain("Bekleyen · 1");
  });
});

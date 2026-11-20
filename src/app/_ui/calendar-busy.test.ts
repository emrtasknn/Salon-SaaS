import { describe, expect, it } from "vitest";

import { busyItems, BUSY_STATUS, isBusyItemId } from "./calendar-busy";
import { appointmentStatusLabels } from "./day-timeline";

describe("phone-calendar busy blocks in the grids", () => {
  const blocks = [{ id: "b1", staffId: "s1", startAt: "2026-11-20T07:00:00.000Z", endAt: "2026-11-20T08:00:00.000Z" }];

  it("become display-only grid items that can never be taken for an appointment id", () => {
    const [item] = busyItems(blocks, (b) => b.staffId);
    expect(item).toMatchObject({ rowId: "s1", status: BUSY_STATUS, customer: "Dolu", startAt: blocks[0].startAt });
    expect(isBusyItemId(item.id)).toBe(true);
    expect(isBusyItemId("b1")).toBe(false);
  });

  it("have a label in the grid", () => {
    expect(appointmentStatusLabels[BUSY_STATUS]).toBe("Telefon takvimi");
  });
});

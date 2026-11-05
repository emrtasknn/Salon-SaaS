import { describe, expect, it } from "vitest";
import { HOUR_PX, MOVE_STEP_MINUTES, snapDeltaMinutes } from "./day-timeline";

describe("drag-to-move snapping", () => {
  const quarterPx = HOUR_PX / 4;

  it("snaps to quarter hours", () => {
    expect(MOVE_STEP_MINUTES).toBe(15);
    expect(snapDeltaMinutes(quarterPx * 0.4, HOUR_PX, -600, 600)).toBe(0);
    expect(snapDeltaMinutes(quarterPx * 0.6, HOUR_PX, -600, 600)).toBe(15);
    expect(snapDeltaMinutes(HOUR_PX, HOUR_PX, -600, 600)).toBe(60);
    expect(snapDeltaMinutes(-quarterPx * 3, HOUR_PX, -600, 600)).toBe(-45);
  });

  it("clamps to the visible grid", () => {
    expect(snapDeltaMinutes(HOUR_PX * 10, HOUR_PX, -60, 90)).toBe(90);
    expect(snapDeltaMinutes(-HOUR_PX * 10, HOUR_PX, -70, 90)).toBe(-60);
  });
});

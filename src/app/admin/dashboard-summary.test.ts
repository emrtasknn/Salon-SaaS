import { describe, expect, it } from "vitest";
import { pendingSummaryText } from "./dashboard-summary";

describe("pendingSummaryText", () => {
  it("says nothing is pending only when no day has a pending request", () => {
    expect(pendingSummaryText(0, 0)).toBe("Onay bekleyen talep yok");
  });

  it("counts pending requests on later days too (matches the bell)", () => {
    expect(pendingSummaryText(0, 1)).toBe("1 talep onay bekliyor · sonraki günlerde");
  });

  it("shows a single count when all pending requests are today", () => {
    expect(pendingSummaryText(2, 2)).toBe("2 talep onay bekliyor");
  });

  it("splits today and total when both exist", () => {
    expect(pendingSummaryText(1, 3)).toBe("3 talep onay bekliyor · 1 tanesi bugün");
  });

  it("falls back to today's count when the total is unknown", () => {
    expect(pendingSummaryText(1, null)).toBe("1 talep onay bekliyor");
    expect(pendingSummaryText(0, null)).toBe("Bugün onay bekleyen talep yok");
  });
});

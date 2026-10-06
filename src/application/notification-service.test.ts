import { describe, expect, it, vi } from "vitest";
import { createNotificationService } from "./notification-service";
import { createMockWhatsAppProvider } from "../infrastructure/notifications";

describe("notification service", () => {
  it("sends created notifications to staff and customer", async () => {
    const calls: Array<Readonly<{ to: string; body: string; templateKey: string }>> = [];
    const repository = {
      recipients: vi.fn().mockResolvedValue([
        { profileId: "s", displayName: "Staff", phone: "+90555", templateKey: "staff", body: "pending" },
        { profileId: "c", displayName: "Customer", phone: "+90556", templateKey: "customer", body: "created" },
      ]),
      claim: vi.fn().mockResolvedValue("claimed"),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };
    const result = await createNotificationService({ repository, provider: createMockWhatsAppProvider(calls) })
      .publish({ tenantId: "t" as never }, "a", "APPOINTMENT_CREATED");
    expect(result.results).toEqual([{ profileId: "s", status: "SENT" }, { profileId: "c", status: "SENT" }]);
    expect(calls).toHaveLength(2);
  });

  it("does not duplicate an already sent delivery", async () => {
    const provider = { channel: "WHATSAPP" as const, send: vi.fn() };
    const repository = {
      recipients: vi.fn().mockResolvedValue([{ profileId: "c", displayName: "C", phone: "+1", templateKey: "x", body: "x" }]),
      claim: vi.fn().mockResolvedValue("already_sent"),
      markSent: vi.fn(), markFailed: vi.fn(),
    };
    const result = await createNotificationService({ repository, provider }).publish({ tenantId: "t" as never }, "a", "APPOINTMENT_CONFIRMED");
    expect(result.results).toEqual([{ profileId: "c", status: "SENT" }]);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

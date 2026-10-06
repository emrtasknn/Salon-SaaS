import { describe, expect, it, vi } from "vitest";
import { createCalendarCrm } from "./calendar-crm";
import { createAuthenticatedIdentity } from "../domain/auth-identity";

const identity = createAuthenticatedIdentity("u", "p");
const tenant = { tenantId: "t" as never };
const repository = {
  listAppointments: vi.fn().mockResolvedValue([]),
  customerCard: vi.fn().mockResolvedValue({ id: "c", displayName: "A", email: null, phone: null, appointments: [], notes: [] }),
  addCustomerNote: vi.fn().mockResolvedValue("created"),
};
const authorizer = { authorize: vi.fn().mockResolvedValue(true) };

describe("calendar crm", () => {
  it("lists a validated calendar range", async () => {
    const result = await createCalendarCrm({ repository, authorizer }).calendar(identity, tenant, {
      startAt: new Date("2026-10-05T00:00:00Z"), endAt: new Date("2026-10-06T00:00:00Z"),
    });
    expect(result.status).toBe("ok");
    expect(repository.listAppointments).toHaveBeenCalled();
  });

  it("reads customer history and adds a note", async () => {
    const manager = createCalendarCrm({ repository, authorizer });
    await expect(manager.customer(identity, tenant, "c")).resolves.toMatchObject({ status: "ok" });
    await expect(manager.addNote(identity, tenant, "c", "Follow up")).resolves.toEqual({ status: "created" });
  });
});

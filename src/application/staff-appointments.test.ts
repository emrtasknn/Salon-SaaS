import { describe, expect, it } from "vitest";
import { createStaffAppointments } from "./staff-appointments";

const tenantContext = { tenantId: "tenant-1" as never };
const otherTenantContext = { tenantId: "tenant-2" as never };
const identity = { state: "authenticated", subjectId: "subject-1", profileId: "profile-1" } as never;
type TestAppointment = {
  id: string;
  tenantId: string;
  staffId: string;
  serviceId: string;
  customerProfileId: string;
  startAt: Date;
  endAt: Date;
  status: "PENDING";
};
const appointment = {
  id: "a1", tenantId: "tenant-1", staffId: "s1", serviceId: "svc", customerProfileId: "c1",
  startAt: new Date("2026-10-06T10:00:00Z"), endAt: new Date("2026-10-06T11:00:00Z"), status: "PENDING",
} as TestAppointment;

describe("staff appointments", () => {
  it("allows a staff decision only through the staff authorization boundary", async () => {
    const result = await createStaffAppointments({
      repository: { listForStaff: async () => [], findById: async () => appointment as never },
      authorizer: { authorizeStaffDecision: async () => true, authorizeAdmin: async () => false },
    }).decide(identity, tenantContext, "a1", "CONFIRMED");
    expect(result.status).toBe("AUTHORIZED");
  });

  it("fails closed when staff decision authorization denies", async () => {
    const result = await createStaffAppointments({
      repository: { listForStaff: async () => [], findById: async () => appointment as never },
      authorizer: { authorizeStaffDecision: async () => false, authorizeAdmin: async () => false },
    }).decide(identity, tenantContext, "a1", "REJECTED");
    expect(result.status).toBe("UNAUTHORIZED");
  });

  it("does not authorize a cross-tenant appointment even when the identifier is supplied directly", async () => {
    const crossTenantAppointment = { ...appointment, tenantId: otherTenantContext.tenantId };
    const authorizeStaffDecision = async (
      _identity: typeof identity,
      context: typeof tenantContext,
      candidate: TestAppointment,
    ) => context.tenantId === candidate.tenantId && candidate.staffId === "s1";

    const result = await createStaffAppointments({
      repository: { listForStaff: async () => [], findById: async () => crossTenantAppointment as never },
      authorizer: { authorizeStaffDecision, authorizeAdmin: async () => false },
    }).decide(identity, tenantContext, "a1", "CONFIRMED");

    expect(result.status).toBe("UNAUTHORIZED");
  });
});

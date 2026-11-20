import { describe, expect, it } from "vitest";
import type { AppointmentStatus } from "./appointment";
import { DELETED_CUSTOMER_NAME, appointmentDeleteRule, isRecordId, type AppointmentDeleteActor } from "./deletion";

describe("appointmentDeleteRule", () => {
  const cases: ReadonlyArray<[AppointmentDeleteActor, AppointmentStatus, string]> = [
    ["TENANT_ADMIN", "PENDING", "MUST_CANCEL_FIRST"],
    ["TENANT_ADMIN", "CONFIRMED", "MUST_CANCEL_FIRST"],
    ["TENANT_ADMIN", "REJECTED", "ALLOWED"],
    ["TENANT_ADMIN", "CANCELLED", "ALLOWED"],
    ["TENANT_ADMIN", "COMPLETED", "ALLOWED"],
    ["ASSIGNED_STAFF", "PENDING", "MUST_CANCEL_FIRST"],
    ["ASSIGNED_STAFF", "CONFIRMED", "MUST_CANCEL_FIRST"],
    ["ASSIGNED_STAFF", "REJECTED", "ALLOWED"],
    ["ASSIGNED_STAFF", "CANCELLED", "ALLOWED"],
    ["ASSIGNED_STAFF", "COMPLETED", "FORBIDDEN"],
  ];

  it.each(cases)("%s + %s -> %s", (actor, status, expected) => {
    expect(appointmentDeleteRule(actor, status)).toBe(expected);
  });
});

describe("isRecordId", () => {
  it("rejects invalid values", () => {
    for (const value of ["", " a", "a ", "a".repeat(101), "a\u0000", 42, null, undefined]) {
      expect(isRecordId(value)).toBe(false);
    }
  });

  it("accepts a cuid and the 100-char boundary", () => {
    expect(isRecordId("clx1abc230000xyz9876defgh")).toBe(true);
    expect(isRecordId("a".repeat(100))).toBe(true);
  });
});

describe("DELETED_CUSTOMER_NAME", () => {
  it("is the Turkish placeholder", () => {
    expect(DELETED_CUSTOMER_NAME).toBe("Silinmiş müşteri");
  });
});

import { describe, expect, it } from "vitest";
import { dedupeRecipients, phoneDedupeKey, type NotificationRecipient } from "./notification";

function recipient(profileId: string, phone: string | null, templateKey = "appointment-created-staff"): NotificationRecipient {
  return { profileId, displayName: profileId, phone, templateKey, body: "body", templateParameters: ["a", "b", "c"] };
}

describe("phoneDedupeKey", () => {
  it("normalizes formatting to digits only", () => {
    expect(phoneDedupeKey("+90 555 111 22 33")).toBe("905551112233");
    expect(phoneDedupeKey("+90 (555) 111-22-33")).toBe("905551112233");
    expect(phoneDedupeKey("905551112233")).toBe("905551112233");
  });

  it("returns null for null, undefined, blank or digit-less input", () => {
    expect(phoneDedupeKey(null)).toBeNull();
    expect(phoneDedupeKey(undefined)).toBeNull();
    expect(phoneDedupeKey("")).toBeNull();
    expect(phoneDedupeKey("   ")).toBeNull();
    expect(phoneDedupeKey("+ () -")).toBeNull();
  });
});

describe("dedupeRecipients", () => {
  const staff = recipient("staff-1", "+90 555 000 00 01");
  const customer = recipient("customer-1", "+90 555 000 00 02", "appointment-created-customer");

  it("keeps staff and customer first and preserves admin order", () => {
    const result = dedupeRecipients({
      staff,
      customer,
      admins: [recipient("admin-b", "+905550000013"), recipient("admin-a", "+905550000011"), recipient("admin-c", "+905550000012")],
    });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-b", "admin-a", "admin-c"]);
    expect(result[0]).toBe(staff);
    expect(result[1]).toBe(customer);
  });

  it("skips an admin who is the assigned staff profile", () => {
    const result = dedupeRecipients({ staff, customer, admins: [recipient("staff-1", "+905559999999")] });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1"]);
    expect(result[0]).toBe(staff);
  });

  it("admin who also serves as the assigned staff gets exactly one message, with or without a customer (owner decision 2026-11-05)", () => {
    const adminStaff = recipient("admin-1", "+905550000001");
    const admins = [recipient("admin-1", "+905550000001"), recipient("admin-2", "+905550000012")];
    for (const withCustomer of [customer, null]) {
      const result = dedupeRecipients({ staff: adminStaff, customer: withCustomer, admins });
      expect(result.filter((r) => r.profileId === "admin-1")).toHaveLength(1);
      expect(result[0]).toBe(adminStaff);
      expect(result.map((r) => r.profileId)).toEqual(withCustomer ? ["admin-1", "customer-1", "admin-2"] : ["admin-1", "admin-2"]);
    }
  });

  it("skips an admin who is the customer profile", () => {
    const result = dedupeRecipients({ staff, customer, admins: [recipient("customer-1", "+905559999999")] });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1"]);
    expect(result[1]).toBe(customer);
  });

  it("skips a duplicate admin profile id", () => {
    const result = dedupeRecipients({ staff, customer, admins: [recipient("admin-1", "+905550000011"), recipient("admin-1", "+905550000099")] });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-1"]);
  });

  it("sends once when admins share a phone in different formats", () => {
    const result = dedupeRecipients({
      staff,
      customer,
      admins: [recipient("admin-1", "+90 555 000 00 11"), recipient("admin-2", "905550000011"), recipient("admin-3", "+90 (555) 000-00-11")],
    });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-1"]);
  });

  it("skips an admin whose phone equals the staff phone", () => {
    const result = dedupeRecipients({ staff, customer, admins: [recipient("admin-1", "905550000001")] });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1"]);
  });

  it("does not skip an admin whose phone equals the customer phone", () => {
    const result = dedupeRecipients({ staff, customer, admins: [recipient("admin-1", "905550000002")] });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-1"]);
  });

  it("always keeps staff and customer even when they share a phone or lack one", () => {
    const shared = dedupeRecipients({
      staff: recipient("staff-1", "+905550000001"),
      customer: recipient("customer-1", "905550000001", "appointment-created-customer"),
      admins: [],
    });
    expect(shared.map((r) => r.profileId)).toEqual(["staff-1", "customer-1"]);

    const missing = dedupeRecipients({
      staff: recipient("staff-1", null),
      customer: recipient("customer-1", null, "appointment-created-customer"),
      admins: [recipient("admin-1", "+905550000011")],
    });
    expect(missing.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-1"]);
  });

  it("never phone-matches admins with a null key", () => {
    const result = dedupeRecipients({
      staff: recipient("staff-1", null),
      customer,
      admins: [recipient("admin-1", null), recipient("admin-2", "  "), recipient("admin-3", "+ -")],
    });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "customer-1", "admin-1", "admin-2", "admin-3"]);
  });

  it("returns staff and customer only when there are no admins", () => {
    expect(dedupeRecipients({ staff, customer, admins: [] })).toEqual([staff, customer]);
  });
});

describe("dedupeRecipients without a customer recipient (WP-10)", () => {
  it("returns staff then admins when the booking has no active WhatsApp opt-in", () => {
    const staff = recipient("staff-1", "+905550000001");
    const result = dedupeRecipients({ staff, customer: null, admins: [recipient("admin-1", "+905550000011"), recipient("admin-2", "+905550000001")] });
    expect(result.map((r) => r.profileId)).toEqual(["staff-1", "admin-1"]);
  });
});

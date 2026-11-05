import { describe, expect, it } from "vitest";

import { activeNavHref, adminNavItems, staffNavItems } from "./nav-items";

describe("activeNavHref", () => {
  it("matches the admin root exactly without stealing sub-areas", () => {
    expect(activeNavHref("/admin", adminNavItems)).toBe("/admin");
    expect(activeNavHref("/admin/", adminNavItems)).toBe("/admin");
    expect(activeNavHref("/admin/calendar", adminNavItems)).toBe("/admin/calendar");
    expect(activeNavHref("/admin/customers", adminNavItems)).toBe("/admin/customers");
  });

  it("keeps the owning tab active on nested paths", () => {
    expect(activeNavHref("/admin/customers/abc", adminNavItems)).toBe("/admin/customers");
    expect(activeNavHref("/staff/appointments", staffNavItems)).toBe("/staff/appointments");
    expect(activeNavHref("/staff", staffNavItems)).toBe("/staff");
  });

  it("does not match look-alike prefixes or other areas", () => {
    expect(activeNavHref("/administrator", adminNavItems)).toBeNull();
    expect(activeNavHref("/staff", adminNavItems)).toBeNull();
    expect(activeNavHref(null, staffNavItems)).toBeNull();
  });

  it("keeps admin and staff link sets separate", () => {
    expect(staffNavItems.some((item) => item.href.startsWith("/admin"))).toBe(false);
    expect(adminNavItems.some((item) => item.href.startsWith("/staff"))).toBe(false);
  });
});

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

describe("nav icons", () => {
  it("gives every tab an icon key the tab bar knows", async () => {
    const { adminServesAsStaffNavItem, backToAdminNavItem, NAV_ICONS } = await import("./nav-items");
    const all = [...adminNavItems, ...staffNavItems, adminServesAsStaffNavItem, backToAdminNavItem];
    for (const item of all) expect(NAV_ICONS, item.label).toContain(item.icon);
  });
});

describe("shownNavHref", () => {
  it("moves the indicator to the tapped tab before the new page has loaded", async () => {
    const { shownNavHref } = await import("./nav-items");
    const pending = { href: "/admin/customers", fromPath: "/admin" };
    expect(shownNavHref(pending, "/admin", adminNavItems)).toBe("/admin/customers");
  });

  it("follows the real path once navigation has happened", async () => {
    const { shownNavHref } = await import("./nav-items");
    const pending = { href: "/admin/customers", fromPath: "/admin" };
    expect(shownNavHref(pending, "/admin/calendar", adminNavItems)).toBe("/admin/calendar");
    expect(shownNavHref(null, "/admin/calendar", adminNavItems)).toBe("/admin/calendar");
  });
});

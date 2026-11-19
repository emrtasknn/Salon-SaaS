import { describe, expect, it } from "vitest";
import { routeTransition } from "./route-transition";

describe("routeTransition", () => {
  it("fades on first load and between tabs", () => {
    expect(routeTransition(null, "/admin")).toBe("fade");
    expect(routeTransition("/admin", "/admin/calendar")).toBe("fade");
    expect(routeTransition("/admin/customers", "/admin")).toBe("fade");
    expect(routeTransition("/admin/calendar", "/staff")).toBe("fade");
    expect(routeTransition("/staff", "/staff/appointments")).toBe("fade");
  });

  it("pushes into a subpage and pops back to its parent", () => {
    expect(routeTransition("/admin", "/admin/staff")).toBe("push");
    expect(routeTransition("/admin/staff", "/admin")).toBe("pop");
    expect(routeTransition("/staff", "/staff/settings")).toBe("push");
    expect(routeTransition("/staff/settings/", "/staff")).toBe("pop");
  });

  it("uses the breadcrumb parent where it differs from the URL", () => {
    expect(routeTransition("/platform/tenants", "/platform/settings")).toBe("push");
    expect(routeTransition("/platform/settings", "/platform/tenants")).toBe("pop");
  });

  it("fades between sibling subpages and on unrelated jumps", () => {
    expect(routeTransition("/admin/staff", "/admin/services")).toBe("fade");
    expect(routeTransition("/admin/settings", "/staff/settings")).toBe("fade");
    expect(routeTransition("/admin", "/admin")).toBe("fade");
  });
});

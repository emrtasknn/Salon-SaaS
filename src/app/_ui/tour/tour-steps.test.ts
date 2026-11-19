import { describe, expect, it } from "vitest";

import { adminNavItems, staffNavItems } from "../nav-items";
import { adminTourSteps, availableTourSteps, navTourTarget, staffTourSteps, tourSteps, TOUR_IDS } from "./tour-steps";

const navTargets = (items: readonly { href: string }[]) => new Set(items.map((item) => navTourTarget(item.href)));

describe("tour steps", () => {
  it("has a tour for each area", () => {
    expect(TOUR_IDS).toEqual(["admin", "staff"]);
    expect(tourSteps("admin")).toBe(adminTourSteps);
    expect(tourSteps("staff")).toBe(staffTourSteps);
  });

  it("opens each tour with a centred welcome step", () => {
    for (const id of TOUR_IDS) expect(tourSteps(id)[0]?.target).toBeNull();
  });

  it("points nav steps only at tabs that area really shows", () => {
    const admin = navTargets(adminNavItems);
    const staff = navTargets(staffNavItems);
    for (const step of adminTourSteps) if (step.target?.startsWith("nav:")) expect(admin.has(step.target)).toBe(true);
    for (const step of staffTourSteps) if (step.target?.startsWith("nav:")) expect(staff.has(step.target)).toBe(true);
  });

  it("keeps step text static and free of markup (driver.js renders it as HTML)", () => {
    for (const step of [...adminTourSteps, ...staffTourSteps]) {
      expect(step.title.trim()).not.toBe("");
      expect(step.description.trim()).not.toBe("");
      expect(`${step.title}${step.description}`).not.toMatch(/[<>&]/);
    }
  });

  it("keeps targets unique within a tour", () => {
    for (const id of TOUR_IDS) {
      const targets = tourSteps(id).flatMap((step) => (step.target ? [step.target] : []));
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});

describe("availableTourSteps", () => {
  it("drops steps whose element is not on the page and keeps centred steps", () => {
    const shown = availableTourSteps(adminTourSteps, (target) => target !== "setup");
    expect(shown.map((step) => step.target)).not.toContain("setup");
    expect(shown[0]?.target).toBeNull();
    expect(shown).toHaveLength(adminTourSteps.length - 1);
  });

  it("leaves only the welcome step when nothing is on the page", () => {
    expect(availableTourSteps(staffTourSteps, () => false)).toEqual([staffTourSteps[0]]);
  });
});

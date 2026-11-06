import { describe, expect, it } from "vitest";
import { SERVICE_CATEGORY_NAME_MAX_LENGTH, groupServicesByCategory, normalizeCategoryName } from "./service-category";

describe("normalizeCategoryName", () => {
  it("trims and accepts a normal name", () => {
    expect(normalizeCategoryName("  Saç  ")).toBe("Saç");
  });
  it("rejects blank, too long, control characters and non-strings", () => {
    expect(() => normalizeCategoryName("   ")).toThrow(TypeError);
    expect(() => normalizeCategoryName("a".repeat(SERVICE_CATEGORY_NAME_MAX_LENGTH + 1))).toThrow(TypeError);
    expect(() => normalizeCategoryName("Saç\nBakım")).toThrow(TypeError);
    expect(() => normalizeCategoryName(5)).toThrow(TypeError);
  });
});

describe("groupServicesByCategory", () => {
  const categories = [
    { id: "c2", name: "Tırnak", sortOrder: 2 },
    { id: "c1", name: "Saç", sortOrder: 1 },
    { id: "c3", name: "Boş", sortOrder: 3 },
  ];
  const services = [
    { id: "s1", name: "Fön", categoryId: "c1" },
    { id: "s2", name: "Manikür", categoryId: "c2" },
    { id: "s3", name: "Danışmanlık", categoryId: null },
    { id: "s4", name: "Kesim", categoryId: "c1" },
    { id: "s5", name: "Silinmiş kategori", categoryId: "gone" },
  ];

  it("orders groups by sortOrder, keeps service order, hides empty groups, puts the rest last", () => {
    const groups = groupServicesByCategory(categories, services);
    expect(groups.map((g) => [g.id, g.name, g.services.map((s) => s.id)])).toEqual([
      ["c1", "Saç", ["s1", "s4"]],
      ["c2", "Tırnak", ["s2"]],
      [null, "Diğer", ["s3", "s5"]],
    ]);
  });

  it("returns a single unnamed group when no categories are used", () => {
    const groups = groupServicesByCategory([], [{ id: "s", name: "Kesim", categoryId: null }]);
    expect(groups).toEqual([{ id: null, name: null, services: [{ id: "s", name: "Kesim", categoryId: null }] }]);
  });
});

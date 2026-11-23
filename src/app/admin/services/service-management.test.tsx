import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("../actions", () => ({
  createServiceAction: vi.fn(),
  createServiceCategoryAction: vi.fn(),
  deleteServiceCategoryAction: vi.fn(),
  deleteServiceAction: vi.fn(),
  moveServiceCategoryAction: vi.fn(),
  renameServiceCategoryAction: vi.fn(),
  toggleServiceAction: vi.fn(),
  updateServiceAction: vi.fn(),
  listAdminData: vi.fn(),
}));

import { ServiceManagement } from "./service-management";

const data = {
  status: "ok",
  services: {
    status: "listed",
    services: [
      { id: "v1", name: "Saç kesimi", durationMinutes: 30, bufferMinutes: 0, active: true, categoryId: "c1", priceMinor: null, priceIsFrom: false },
    ],
  },
  serviceCategories: [{ id: "c1", name: "Bakım", sortOrder: 0 }],
  workingHours: { status: "listed", workingHours: [] },
  staff: { status: "listed", staff: [] },
  adminServesAsStaff: false,
  staffServices: {},
} as never;

describe("ServiceManagement delete", () => {
  const html = renderToStaticMarkup(<ServiceManagement initialData={data} />);

  it("offers a named delete button per service", () => {
    expect(html).toContain('aria-label="Saç kesimi hizmetini sil"');
  });

  it("routes the category delete through the confirmation dialog, not an immediate action", () => {
    expect(html).toContain('aria-label="Bakım kategorisini sil"');
    expect(html).not.toContain("<dialog");
  });
});

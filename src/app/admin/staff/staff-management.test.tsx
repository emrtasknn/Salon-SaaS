import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("../actions", () => ({
  createStaffAction: vi.fn(),
  setStaffServicesAction: vi.fn(),
  setStaffStatusAction: vi.fn(),
  updateStaffProfileAction: vi.fn(),
  deleteStaffAction: vi.fn(),
  listAdminData: vi.fn(),
}));
vi.mock("../serves-as-staff-toggle", () => ({ ServesAsStaffToggle: () => null }));

import { StaffManagement } from "./staff-management";

const data = {
  status: "ok",
  services: { status: "listed", services: [] },
  serviceCategories: [],
  workingHours: { status: "listed", workingHours: [] },
  staff: {
    status: "listed",
    staff: [
      { id: "s1", displayName: "Ayşe Yılmaz", phone: null, status: "ACTIVE" },
      { id: "s2", displayName: "Mehmet Kaya", phone: null, status: "INACTIVE" },
    ],
  },
  adminServesAsStaff: false,
  staffServices: {},
} as never;

describe("StaffManagement delete", () => {
  it("offers a named delete button per staff member", () => {
    const html = renderToStaticMarkup(<StaffManagement initialData={data} />);
    expect(html).toContain('aria-label="Ayşe Yılmaz personelini sil"');
    expect(html).toContain('aria-label="Mehmet Kaya personelini sil"');
    expect(html).not.toContain("<dialog");
  });
});

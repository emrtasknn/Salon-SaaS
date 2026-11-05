import type { ReactNode } from "react";

import { AppNavShell } from "../_ui/app-nav";
import { backToAdminNavItem, staffNavItems } from "../_ui/nav-items";
import { readAdminStaffFlag } from "../admin/admin-staff-flag";

// Navigation only: each staff page authorizes itself. An admin who also serves customers
// gets a "Yönetim" tab back to /admin (which re-checks the admin role).
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const isServingAdmin = await readAdminStaffFlag();
  const items = isServingAdmin ? [backToAdminNavItem, ...staffNavItems] : staffNavItems;
  return <AppNavShell items={items} label="Personel menüsü">{children}</AppNavShell>;
}

import type { ReactNode } from "react";

import { AppNavShell } from "../_ui/app-nav";
import { adminNavItems, adminServesAsStaffNavItem } from "../_ui/nav-items";
import { readAdminStaffFlag } from "./admin-staff-flag";

// Navigation only: each admin page authorizes itself. The flag only decides whether to show
// a "Randevularım" tab for an admin who also serves customers; /staff re-checks access.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const servesAsStaff = await readAdminStaffFlag();
  const items = servesAsStaff ? [...adminNavItems, adminServesAsStaffNavItem] : adminNavItems;
  return <AppNavShell items={items} label="Yönetim menüsü">{children}</AppNavShell>;
}

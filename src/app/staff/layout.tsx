import type { ReactNode } from "react";

import { AppNavShell } from "../_ui/app-nav";
import { staffNavItems } from "../_ui/nav-items";

// Navigation only: no data fetching or auth here; each staff page authorizes itself.
export default function StaffLayout({ children }: { children: ReactNode }) {
  return <AppNavShell items={staffNavItems} label="Personel menüsü">{children}</AppNavShell>;
}

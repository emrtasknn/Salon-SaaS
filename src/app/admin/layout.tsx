import type { ReactNode } from "react";

import { AppNavShell } from "../_ui/app-nav";
import { adminNavItems } from "../_ui/nav-items";

// Navigation only: no data fetching or auth here; each admin page authorizes itself.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppNavShell items={adminNavItems} label="Yönetim menüsü">{children}</AppNavShell>;
}

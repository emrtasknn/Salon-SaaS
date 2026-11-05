// Navigation-only link sets for the signed-in areas. A visible tab is never
// authorization: every page re-checks identity, tenant and role on the server.

export type NavItem = { href: string; label: string };

export const adminNavItems: readonly NavItem[] = [
  { href: "/admin", label: "Yönetim" },
  { href: "/admin/calendar", label: "Takvim" },
  { href: "/admin/customers", label: "Müşteriler" },
];

/** Extra tab for a TENANT_ADMIN who also serves customers (navigation only; /staff re-authorizes). */
export const adminServesAsStaffNavItem: NavItem = { href: "/staff", label: "Randevularım" };

/** Shown in the staff area to such an admin so they can return to the admin area. */
export const backToAdminNavItem: NavItem = { href: "/admin", label: "Yönetim" };

export const staffNavItems: readonly NavItem[] = [
  { href: "/staff", label: "Takvim" },
  { href: "/staff/appointments", label: "Randevularım" },
];

/**
 * Returns the href of the tab that owns `pathname`: an exact match, otherwise the
 * longest item whose href is a path-segment prefix (so nested views keep their tab
 * active, while "/admin" never steals "/admin/calendar").
 */
export function activeNavHref(pathname: string | null, items: readonly NavItem[]): string | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  let best: string | null = null;
  for (const { href } of items) {
    const matches = path === href || path.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

// Navigation-only link sets for the signed-in areas. A visible tab is never
// authorization: every page re-checks identity, tenant and role on the server.

/** Icon keys (plain strings so server layouts can pass items to the client tab bar). */
export const NAV_ICONS = ["manage", "calendar", "customers", "appointments"] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

export type NavItem = { href: string; label: string; icon: NavIcon };

export const adminNavItems: readonly NavItem[] = [
  { href: "/admin", label: "Yönetim", icon: "manage" },
  { href: "/admin/calendar", label: "Takvim", icon: "calendar" },
  { href: "/admin/customers", label: "Müşteriler", icon: "customers" },
];

/** Extra tab for a TENANT_ADMIN who also serves customers (navigation only; /staff re-authorizes). */
export const adminServesAsStaffNavItem: NavItem = { href: "/staff", label: "Randevularım", icon: "appointments" };

/** Shown in the staff area to such an admin so they can return to the admin area. */
export const backToAdminNavItem: NavItem = { href: "/admin", label: "Yönetim", icon: "manage" };

export const staffNavItems: readonly NavItem[] = [
  { href: "/staff", label: "Takvim", icon: "calendar" },
  { href: "/staff/appointments", label: "Randevularım", icon: "appointments" },
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

/** A tab the user just tapped, remembered together with the path they tapped it from. */
export type PendingNav = Readonly<{ href: string; fromPath: string | null }>;

/**
 * Tab to highlight: the tapped one while the old page is still showing (so the indicator moves
 * with the finger, not after the server responds), otherwise the tab that owns the current path.
 * Display only; the destination page authorizes itself.
 */
export function shownNavHref(pending: PendingNav | null, pathname: string | null, items: readonly NavItem[]): string | null {
  if (pending && pending.fromPath === pathname) return pending.href;
  return activeNavHref(pathname, items);
}

// Which entry motion a page gets after a client-side navigation (presentation only).
// "Karma" (owner decision 2026-11-19): moving between tabs fades in place; drilling into a
// subpage pushes in from the right, going back to its parent comes in from the left.

import { adminNavItems, adminServesAsStaffNavItem, backToAdminNavItem, staffNavItems } from "./nav-items";

export type RouteMotionKind = "fade" | "push" | "pop" | "still";

/** Top-level screens reached from the tab bar (or the platform's only list). */
export const TAB_ROOTS: ReadonlySet<string> = new Set([
  ...adminNavItems.map((item) => item.href),
  adminServesAsStaffNavItem.href,
  backToAdminNavItem.href,
  ...staffNavItems.map((item) => item.href),
  "/platform/tenants",
]);

/** Subpages whose parent is not their URL parent (the breadcrumb's previous step). */
const PARENTS: Readonly<Record<string, string>> = {
  "/platform/settings": "/platform/tenants",
};

function normalize(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function parentOf(path: string): string | null {
  if (PARENTS[path]) return PARENTS[path];
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : path === "/" ? null : "/";
}

/** True when `ancestor` is on the parent chain of `path`. */
function isAncestor(ancestor: string, path: string): boolean {
  for (let p = parentOf(path); p !== null; p = parentOf(p)) {
    if (p === ancestor) return true;
  }
  return false;
}

export function routeTransition(previous: string | null, next: string, tabRoots: ReadonlySet<string> = TAB_ROOTS): RouteMotionKind {
  if (previous === null) return "fade";
  const from = normalize(previous);
  const to = normalize(next);
  if (from === to) return "fade";
  if (tabRoots.has(from) && tabRoots.has(to)) return "fade";
  if (isAncestor(from, to)) return "push";
  if (isAncestor(to, from)) return "pop";
  return "fade";
}

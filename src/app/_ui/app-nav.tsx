"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { activeNavHref, type NavItem } from "./nav-items";

/**
 * Area navigation for standalone PWA mode (no browser back button).
 * Phones (<768px): fixed bottom tab bar on the glass material with safe-area padding.
 * ≥768px: the same links as a segmented row at the top of the page.
 * Presentation only: links are navigation, never authorization.
 */
export function AppNavShell({
  items,
  label,
  children,
}: {
  items: readonly NavItem[];
  label: string;
  children: ReactNode;
}) {
  const active = activeNavHref(usePathname(), items);

  return (
    <>
      <nav aria-label={label} className="hidden bg-canvas px-6 pt-4 md:block">
        <div className="mx-auto max-w-6xl">
          <ul className="inline-flex gap-1 rounded-control bg-surface-muted p-1 shadow-[inset_0_0_0_1px_var(--color-separator)]">
            {items.map((item) => {
              const current = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={`focus-ring tap-target inline-flex items-center justify-center rounded-[10px] px-4 text-subhead font-semibold transition-colors ${
                      current ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Bottom padding keeps page content (and its last CTA) clear of the fixed tab bar on phones. */}
      <div data-app-content="" className="flex flex-1 flex-col pb-[calc(3.5rem+max(0.5rem,env(safe-area-inset-bottom)))] md:pb-0">
        {children}
      </div>

      <nav
        aria-label={label}
        data-app-tabbar=""
        className="glass fixed inset-x-0 bottom-0 z-30 border-t pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
      >
        <ul className="mx-auto flex max-w-xl px-2">
          {items.map((item) => {
            const current = item.href === active;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={`focus-ring flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-control px-2 text-footnote font-semibold ${
                    current ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  <span aria-hidden="true" className={`h-1 w-6 rounded-full ${current ? "bg-action" : "bg-transparent"}`} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CalendarCheck, CalendarDays, LayoutGrid, Users } from "lucide-react";

import { haptic } from "@/lib/haptics";
import { shownNavHref, type NavIcon, type NavItem, type PendingNav } from "./nav-items";

const icons: Record<NavIcon, ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>> = {
  manage: LayoutGrid,
  calendar: CalendarDays,
  customers: Users,
  appointments: CalendarCheck,
};

/**
 * Area navigation for standalone PWA mode (no browser back button).
 * Phones (<768px): fixed bottom tab bar on the glass material with safe-area padding; each tab is
 * an icon over a label, and a lilac pill slides to the selected tab (it moves on tap, before the
 * new page arrives). ≥768px: the same links as a segmented row at the top of the page.
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
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingNav | null>(null);
  const active = shownNavHref(pending, pathname, items);
  const reduceMotion = useReducedMotion();

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
        <ul className="mx-auto flex max-w-xl gap-1 px-2">
          {items.map((item) => {
            const current = item.href === active;
            const Icon = icons[item.icon];
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  onClick={() => {
                    if (current) return;
                    haptic("selection");
                    setPending({ href: item.href, fromPath: pathname });
                  }}
                  className={`focus-ring relative isolate flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 text-caption font-semibold transition-colors duration-150 ${
                    current ? "text-on-tint" : "text-ink-muted"
                  }`}
                >
                  <Icon className="size-[22px] shrink-0" aria-hidden strokeWidth={current ? 2.25 : 2} />
                  <span className="max-w-full truncate">{item.label}</span>
                  {current ? (
                    <motion.span
                      layoutId="app-tab-pill"
                      data-nav-pill=""
                      aria-hidden="true"
                      className="absolute inset-0 -z-10 rounded-[14px] bg-tint"
                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40, mass: 0.9 }}
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

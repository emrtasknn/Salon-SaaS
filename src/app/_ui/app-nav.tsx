"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CalendarCheck, CalendarDays, LayoutGrid, Users } from "lucide-react";

import { haptic } from "@/lib/haptics";
import { lensIndex, lensOffset, shownNavHref, type NavIcon, type NavItem, type PendingNav } from "./nav-items";

const icons: Record<NavIcon, ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>> = {
  manage: LayoutGrid,
  calendar: CalendarDays,
  customers: Users,
  appointments: CalendarCheck,
};

/** Finger travel before a press on the tab bar counts as a drag rather than a tap. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Area navigation for standalone PWA mode (no browser back button).
 * Phones (<768px): a floating glass capsule above the safe area; each tab is an icon over a label,
 * and a lilac pill slides to the selected tab (it moves on tap, before the new page arrives).
 * Pressing the bar lifts a glass lens that can be dragged across the tabs; releasing selects the
 * tab under it. Tapping and the keyboard keep working as plain links. ≥768px: the same links as a segmented row at the top of the page.
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
  const router = useRouter();

  // Press-and-drag on the phone tab bar: a glass lens lifts under the finger, follows it across the
  // tabs and selects the tab it is released on. `press.at` is the finger position in tab units.
  const listRef = useRef<HTMLUListElement>(null);
  const [press, setPress] = useState<{ at: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const stopPress = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPress.current?.(), []);

  const activeIndex = items.findIndex((item) => item.href === active);
  const pressIndex = press ? lensIndex(press.at, items.length) : -1;
  const shownIndex = press ? pressIndex : activeIndex;
  const lifted = press !== null;
  // translateX in % of the lens' own width (one tab): whole tabs at rest, continuous while dragged.
  const lensX = press?.dragged ? lensOffset(press.at, items.length) * 100 : Math.max(shownIndex, 0) * 100;
  const spring = { type: "spring", stiffness: 520, damping: 40, mass: 0.9 } as const;

  function startPress(event: ReactPointerEvent<HTMLUListElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const list = listRef.current;
    if (!list) return;
    stopPress.current?.();
    suppressClick.current = false;
    const rect = list.getBoundingClientRect();
    const startX = event.clientX;
    const position = (clientX: number) => ((clientX - rect.left) / rect.width) * items.length;
    let lastIndex = lensIndex(position(startX), items.length);
    let dragged = false;
    setPress({ at: position(startX), dragged: false });

    const move = (e: PointerEvent) => {
      if (!dragged && Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX) return;
      dragged = true;
      const at = position(e.clientX);
      const index = lensIndex(at, items.length);
      if (index !== lastIndex) {
        lastIndex = index;
        haptic("selection");
      }
      setPress({ at, dragged: true });
    };
    const end = (e: PointerEvent) => {
      stop();
      if (!dragged || e.type === "pointercancel") return; // a plain tap is handled by the link itself
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 400);
      const target = items[lastIndex];
      if (!target || target.href === active) return;
      setPending({ href: target.href, fromPath: pathname });
      router.push(target.href);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stopPress.current = null;
      setPress(null);
    };
    stopPress.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

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
      <div data-app-content="" className="flex flex-1 flex-col pb-[calc(4.75rem+max(0.5rem,env(safe-area-inset-bottom)))] md:pb-0">
        {children}
      </div>

      <nav
        aria-label={label}
        data-app-tabbar=""
        className="tab-bar-float glass fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-xl rounded-full border p-1 md:hidden"
      >
        <ul
          ref={listRef}
          onPointerDown={startPress}
          className="relative isolate flex touch-none select-none [-webkit-touch-callout:none]"
        >
          {/* Resting indicator: the lilac pill behind the selected tab. Fades out while the lens is lifted. */}
          {shownIndex >= 0 ? (
            <motion.span
              data-nav-pill=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 -z-10 rounded-full bg-tint"
              style={{ width: `${100 / items.length}%` }}
              initial={false}
              animate={{ x: `${lensX}%`, opacity: lifted ? 0 : 1 }}
              transition={reduceMotion ? { duration: 0 } : { x: spring, opacity: { duration: 0.15 } }}
            />
          ) : null}
          {items.map((item, index) => {
            const current = item.href === active;
            const highlighted = index === shownIndex;
            const Icon = icons[item.icon];
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  draggable={false}
                  aria-current={current ? "page" : undefined}
                  onClick={(event) => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      event.preventDefault();
                      return;
                    }
                    if (current) return;
                    haptic("selection");
                    setPending({ href: item.href, fromPath: pathname });
                  }}
                  className={`focus-ring relative flex min-h-[52px] w-full items-center justify-center rounded-full px-1 text-caption font-semibold transition-colors duration-150 ${
                    highlighted ? "text-on-tint" : "text-ink-muted"
                  }`}
                >
                  {/* The tab under the lifted lens is drawn slightly larger, as if magnified by it. */}
                  <motion.span
                    className="flex max-w-full flex-col items-center justify-center gap-0.5"
                    initial={false}
                    animate={{ scale: lifted && highlighted && !reduceMotion ? 1.14 : 1 }}
                    transition={reduceMotion ? { duration: 0 } : spring}
                  >
                    <Icon className="size-[22px] shrink-0" aria-hidden strokeWidth={highlighted ? 2.25 : 2} />
                    <span className="max-w-full truncate">{item.label}</span>
                  </motion.span>
                </Link>
              </li>
            );
          })}
          {/* Glass lens: appears while the bar is pressed, follows the finger and settles on release. */}
          <motion.span
            data-nav-lens=""
            aria-hidden="true"
            className="tab-lens pointer-events-none absolute inset-y-0 left-0 z-10 rounded-full"
            style={{ width: `${100 / items.length}%` }}
            initial={false}
            animate={{
              x: `${lensX}%`,
              opacity: lifted ? 1 : 0,
              scaleX: lifted && !reduceMotion ? 1.12 : 1,
              scaleY: lifted && !reduceMotion ? 1.3 : 1,
            }}
            transition={reduceMotion ? { duration: 0 } : { default: spring, opacity: { duration: 0.15 } }}
          />
        </ul>
      </nav>
    </>
  );
}

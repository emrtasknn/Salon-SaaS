"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { routeTransition, type RouteMotionKind } from "./route-transition";

// Path of the page shown before this navigation. Client-only: effects never run on the server,
// so server renders always see null ("fade") and hydration matches.
let lastPath: string | null = null;

/**
 * Entry motion for a page, rendered by an area's template.tsx (which remounts on every
 * navigation). The CSS in globals.css (`[data-route-motion]`) animates opacity/transform once
 * and leaves no transform behind. `still` (public pages with a fixed booking bar) fades only.
 */
export function RouteMotion({ children, still = false }: { children: ReactNode; still?: boolean }) {
  const pathname = usePathname();
  const [kind] = useState<RouteMotionKind>(() => (still ? "still" : routeTransition(lastPath, pathname)));
  useEffect(() => {
    lastPath = pathname;
  }, [pathname]);
  return (
    <div data-route-motion={kind} className="flex flex-1 flex-col">
      {children}
    </div>
  );
}

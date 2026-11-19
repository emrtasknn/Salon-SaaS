import type { ReactNode } from "react";
import { RouteMotion } from "../_ui/route-motion";

// Remounts on every navigation inside this area, so each page enters with motion. Presentation only.
export default function Template({ children }: { children: ReactNode }) {
  return <RouteMotion>{children}</RouteMotion>;
}

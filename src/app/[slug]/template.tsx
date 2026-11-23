import type { ReactNode } from "react";
import { RouteMotion } from "../_ui/route-motion";

// Public pages fade only: the booking page has a fixed action bar that a transform would detach.
export default function Template({ children }: { children: ReactNode }) {
  return <RouteMotion still>{children}</RouteMotion>;
}

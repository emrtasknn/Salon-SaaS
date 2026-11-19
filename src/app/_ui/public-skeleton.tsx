import type { ReactNode } from "react";
import { Bone } from "./skeleton";

/** Public (customer) page skeleton: breadcrumb, large title, then the given body. */
export function PublicSkeleton({ children }: { children: ReactNode }) {
  return (
    <main aria-busy="true" className="skeleton-screen min-h-screen bg-canvas text-ink">
      <p role="status" className="sr-only">Yükleniyor…</p>
      <div className="mx-auto w-full max-w-xl space-y-6 px-4 pb-10 pt-4 sm:px-6">
        <Bone className="h-4 w-32" />
        <Bone className="h-10 w-3/4" />
        {children}
      </div>
    </main>
  );
}

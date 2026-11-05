import type { ReactNode } from "react";

/**
 * Sticky floating top bar using the glass material (functional layer only).
 * Content beneath it stays solid; never nest another glass surface inside.
 */
export function AppBar({
  children,
  widthClassName = "max-w-xl",
}: {
  children: ReactNode;
  widthClassName?: string;
}) {
  return (
    <div className="glass safe-top sticky top-0 z-30 border-b px-4 pb-2 sm:px-6">
      <div className={`mx-auto flex min-h-11 flex-wrap items-center justify-between gap-2 ${widthClassName}`}>
        {children}
      </div>
    </div>
  );
}

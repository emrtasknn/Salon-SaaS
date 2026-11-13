import type { ReactNode } from "react";
import { Breadcrumb, type BreadcrumbStep } from "@/components/ui/breadcrumb";
import { cx } from "@/lib/utils";

/**
 * Fixed top layer for every signed-in screen: breadcrumb, page title and the right-hand
 * accessory (notification bell, push switch, page actions) stay in one sticky glass bar while
 * the content scrolls underneath. An optional toolbar row (`children`, e.g. date stepper and
 * view switch) lives in the same bar so two sticky bars never stack. Presentation only.
 */
export function PageHeader({
  title,
  eyebrow,
  breadcrumb,
  accessory,
  children,
  widthClassName = "max-w-xl",
  titleAs: Title = "h1",
}: {
  title: ReactNode;
  /** Small line above the title (salon · date). */
  eyebrow?: ReactNode;
  breadcrumb?: readonly BreadcrumbStep[];
  accessory?: ReactNode;
  /** Optional toolbar row under the title. */
  children?: ReactNode;
  widthClassName?: string;
  /** Use "p" when the page already renders its own h1. */
  titleAs?: "h1" | "p";
}) {
  return (
    <header data-page-header className="glass safe-top sticky top-0 z-30 border-b pb-3">
      {/* Same inner width + padding as the page content below, so edges line up. */}
      <div className={cx("mx-auto w-full px-4 sm:px-6", widthClassName)}>
        {breadcrumb && breadcrumb.length > 0 ? <Breadcrumb items={breadcrumb} className="pt-1" /> : null}
        <div className={cx("flex items-end justify-between gap-3", breadcrumb?.length ? "pt-0.5" : "pt-3")}>
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <p className="text-footnote font-semibold text-ink-muted [overflow-wrap:anywhere]">{eyebrow}</p>
            ) : null}
            {/* Two lines at most; a long name wraps instead of being cut to a few letters. */}
            <Title className="line-clamp-2 text-balance text-title text-ink [overflow-wrap:anywhere] sm:text-large-title">{title}</Title>
          </div>
          {accessory ? <div className="flex shrink-0 items-center gap-2">{accessory}</div> : null}
        </div>
        {children ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2">{children}</div> : null}
      </div>
    </header>
  );
}

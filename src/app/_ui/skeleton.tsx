import type { ReactNode } from "react";
import type { BreadcrumbStep } from "@/components/ui/breadcrumb";
import { cx } from "@/lib/utils";
import { PageHeader } from "./page-header";

/*
 * Loading skeletons for loading.tsx files and in-page waits. Shapes follow the real screens so
 * nothing jumps when the content arrives. The screen fades in after 150ms (globals.css
 * `.skeleton-screen`), blocks shimmer unless reduced motion is requested, and a hidden status
 * line tells assistive tech that the page is loading. Presentation only.
 */

/** One grey placeholder block. */
export function Bone({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("skeleton-block block", className)} />;
}

/** Whole-page skeleton: header + body, announced as loading. */
export function SkeletonScreen({
  title,
  eyebrow = false,
  breadcrumb,
  accessory = false,
  toolbar,
  widthClassName = "max-w-xl",
  children,
}: {
  /** Known page title; a placeholder block when omitted (e.g. the greeting). */
  title?: string;
  eyebrow?: boolean;
  breadcrumb?: readonly BreadcrumbStep[];
  /** Round placeholder where the bell sits. */
  accessory?: boolean;
  toolbar?: ReactNode;
  widthClassName?: string;
  children: ReactNode;
}) {
  return (
    <main aria-busy="true" className="skeleton-screen min-h-screen bg-canvas text-ink">
      <p role="status" className="sr-only">Yükleniyor…</p>
      <PageHeader
        title={title ?? <Bone className="h-8 w-56 max-w-full" />}
        titleAs={title ? "h1" : "p"}
        eyebrow={eyebrow ? <Bone className="h-4 w-40" /> : undefined}
        breadcrumb={breadcrumb}
        accessory={accessory ? <Bone className="size-11 rounded-full" /> : undefined}
        widthClassName={widthClassName}
      >
        {toolbar}
      </PageHeader>
      <div className={cx("mx-auto w-full space-y-8 px-4 pb-10 pt-6 sm:px-6", widthClassName)}>{children}</div>
    </main>
  );
}

/** Group label + inset list with `rows` rows (one or two text lines each). */
export function SkeletonList({ rows = 4, lines = 2, label = true, trailing = false }: { rows?: number; lines?: 1 | 2; label?: boolean; trailing?: boolean }) {
  return (
    <section aria-hidden="true">
      {label ? <Bone className="mx-4 mb-2 h-3.5 w-24" /> : null}
      <ul className="inset-group">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="inset-row flex min-h-11 items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 space-y-2">
              <Bone className={cx("h-4", index % 2 === 0 ? "w-3/5" : "w-2/5")} />
              {lines === 2 ? <Bone className="h-3 w-1/3" /> : null}
            </span>
            {trailing ? <Bone className="h-8 w-20 rounded-full" /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A single card-sized block (e.g. "Bugün" summary, calendar grid). */
export function SkeletonCard({ className }: { className?: string }) {
  return <Bone className={cx("h-24 w-full rounded-card", className)} />;
}

/** Time-slot chips while availability loads. */
export function SkeletonSlots({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Bone key={index} className="h-11 rounded-control" />
      ))}
    </div>
  );
}

/** Calendar toolbar placeholder (view switch + date stepper) for the header. */
export function SkeletonCalendarToolbar() {
  return (
    <>
      <Bone className="h-10 w-64 max-w-full rounded-control" />
      <Bone className="h-11 w-72 max-w-full rounded-control" />
    </>
  );
}

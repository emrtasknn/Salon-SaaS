import Link from "next/link";
import type { ComponentType } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "@/lib/utils";

/*
 * Breadcrumb — adapted from BoardUI's Breadcrumb (MIT, https://www.boardui.com/components/breadcrumb),
 * restyled with RandevuN tokens. Separators live inside <li> (valid list markup). On phones only the
 * parent step is shown as a "‹ Parent" back link (standalone PWA has no browser back button); from
 * `sm` up the full trail is shown.
 */

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export type BreadcrumbStep = { label: string; href?: string; icon?: IconComponent };

export function Breadcrumb({ items, className }: { items: readonly BreadcrumbStep[]; className?: string }) {
  if (items.length === 0) return null;
  const parent = [...items].reverse().find((item, index) => index > 0 && item.href);

  return (
    <nav aria-label="Konum" className={cx("-ml-2", className)}>
      {parent?.href ? (
        <Link
          href={parent.href}
          className="focus-ring tap-target inline-flex items-center gap-0.5 rounded-control px-2 text-body font-medium text-ink hover:bg-surface-muted sm:hidden"
        >
          <ChevronLeft className="size-5 shrink-0" aria-hidden />
          {parent.label}
        </Link>
      ) : null}
      <ol className={cx("flex-wrap items-center gap-1", parent?.href ? "hidden sm:flex" : "flex")}>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          const Icon = item.icon;
          const content = (
            <>
              {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
              {item.label}
            </>
          );
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="size-3.5 shrink-0 text-ink-muted" aria-hidden /> : null}
              {current || !item.href ? (
                <span
                  aria-current={current ? "page" : undefined}
                  className="inline-flex items-center gap-1.5 px-2 text-subhead font-medium text-ink-muted"
                >
                  {content}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="focus-ring tap-target inline-flex items-center gap-1.5 rounded-control px-2 text-subhead font-medium text-ink hover:bg-surface-muted"
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

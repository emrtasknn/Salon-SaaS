"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { cx } from "@/lib/utils";

/*
 * Notice — inline feedback card adapted from BoardUI's Notification (MIT,
 * https://www.boardui.com/components/notification): status icon disc, title/body, short
 * fade + rise + blur entrance (skipped for reduced motion). Rendered in place (not a floating
 * toast) so existing live-region semantics stay as they were.
 */

export type NoticeTone = "info" | "success" | "error";

const toneStyles: Record<NoticeTone, { disc: string; Icon: typeof Info }> = {
  info: { disc: "bg-status-completed-bg text-status-completed", Icon: Info },
  success: { disc: "bg-accent-soft text-accent-ink", Icon: CircleCheck },
  error: { disc: "bg-status-rejected-bg text-status-rejected", Icon: CircleAlert },
};

export const noticeCardClassName =
  "flex w-full items-start gap-3 rounded-card border border-separator bg-surface p-3.5 text-subhead text-ink shadow-raised";

export function Notice({
  tone = "info",
  title,
  children,
  role,
  className,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Defaults to "alert" for errors and "status" otherwise. */
  role?: "status" | "alert" | "none";
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const { disc, Icon } = toneStyles[tone];
  return (
    <motion.div
      role={role === "none" ? undefined : (role ?? (tone === "error" ? "alert" : "status"))}
      initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.25, ease: "easeOut" } }}
      className={cx(noticeCardClassName, className)}
    >
      <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-full", disc)}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 self-center">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "text-ink-muted" : undefined}>{children}</div> : null}
      </div>
    </motion.div>
  );
}

import { cx } from "@/lib/utils";

/**
 * Confirmation mark: a tick on the accent disc. With motion allowed it pops in, the tick draws and
 * one ring spreads (globals.css `.success-mark`); otherwise it is simply shown complete.
 * Decoration only: the heading next to it carries the meaning.
 */
export function SuccessMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("success-mark relative inline-flex size-14 items-center justify-center rounded-full bg-accent text-on-accent", className)}
    >
      <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5 10 17.5 19 7" pathLength={1} />
      </svg>
    </span>
  );
}

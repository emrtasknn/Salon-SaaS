// Shared class recipes built on the semantic tokens in globals.css.
// Presentation only: none of these carry authorization or domain meaning.

// Buttons: use <Button> / <ButtonLink> / <ButtonAnchor> from "@/components/ui/button".

/**
 * Native field look (BoardUI Input style: filled field that lifts to the surface on hover/focus),
 * for <input>, <select> and <textarea>. 17px text so iOS Safari does not zoom on focus.
 * Inline variant sizes to content (toolbars). Labelled text fields can use <Input> from
 * "@/components/ui/input" instead.
 */
export const fieldInline =
  "focus-ring tap-target rounded-control border border-field-border bg-surface-muted px-3.5 py-2.5 text-body text-ink placeholder:text-ink-muted transition-[background-color,border-color] duration-150 hover:bg-surface focus-visible:bg-surface disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-status-rejected-bg";

export const field = `w-full ${fieldInline}`;

export const card = "inset-group p-5";

/**
 * iOS-style switch on a native checkbox (keep role="switch"). Track turns status-confirmed when on;
 * the thumb slides (no motion when reduced motion is requested).
 */
export const switchClassName =
  "focus-ring relative mt-0.5 h-[31px] w-[51px] shrink-0 cursor-pointer appearance-none rounded-full bg-separator transition-colors duration-200 checked:bg-status-confirmed disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-[2px] before:top-[2px] before:size-[27px] before:rounded-full before:bg-surface before:shadow-raised before:ring-1 before:ring-separator before:transition-transform before:duration-200 before:content-[''] checked:before:translate-x-5 motion-reduce:before:transition-none";

/** Inline feedback card (BoardUI Notification look). For a toned card with an icon use <Notice>. */
export const statusNote =
  "rounded-card border border-separator bg-surface p-3.5 text-subhead text-ink shadow-raised";

export const appointmentStatusBadge: Record<string, string> = {
  PENDING: "bg-status-pending-bg text-status-pending",
  CONFIRMED: "bg-status-confirmed-bg text-status-confirmed",
  REJECTED: "bg-status-rejected-bg text-status-rejected",
  CANCELLED: "bg-status-cancelled-bg text-status-cancelled",
  COMPLETED: "bg-status-completed-bg text-status-completed",
};

export const badgeBase = "inline-flex items-center rounded-full px-2.5 py-1 text-footnote font-semibold";

/**
 * Per-staff colors for the week view. Each entry reads an optional `--staff-N-*` token so a theme
 * (e.g. dark mode in globals.css) can override it; the fallback is the light value. Text on these
 * tints stays `ink` (≥ 4.5:1). Staff identity is also always written as text (legend + bar label).
 */
export const staffPalette: ReadonlyArray<{ bar: string; dot: string }> = [
  { bar: "bg-[color:var(--staff-1-bg,#e3effd)] border-l-[color:var(--staff-1,#0a64c2)]", dot: "bg-[color:var(--staff-1,#0a64c2)]" },
  { bar: "bg-[color:var(--staff-2-bg,#e2f4e7)] border-l-[color:var(--staff-2,#1f7a3d)]", dot: "bg-[color:var(--staff-2,#1f7a3d)]" },
  { bar: "bg-[color:var(--staff-3-bg,#fdeedd)] border-l-[color:var(--staff-3,#b35900)]", dot: "bg-[color:var(--staff-3,#b35900)]" },
  { bar: "bg-[color:var(--staff-4-bg,#efe7fb)] border-l-[color:var(--staff-4,#6e3ab5)]", dot: "bg-[color:var(--staff-4,#6e3ab5)]" },
  { bar: "bg-[color:var(--staff-5-bg,#fce6ef)] border-l-[color:var(--staff-5,#b0245e)]", dot: "bg-[color:var(--staff-5,#b0245e)]" },
  { bar: "bg-[color:var(--staff-6-bg,#ddf2f2)] border-l-[color:var(--staff-6,#0d7377)]", dot: "bg-[color:var(--staff-6,#0d7377)]" },
];

/** Status dot fill (month view); always paired with a text count in the accessible name. */
export const appointmentStatusDot: Record<string, string> = {
  PENDING: "bg-status-pending",
  CONFIRMED: "bg-status-confirmed",
  REJECTED: "bg-status-rejected",
  CANCELLED: "bg-status-cancelled",
  COMPLETED: "bg-status-completed",
};

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
 * the thumb slides (no motion when reduced motion is requested). The thumb uses the fixed
 * `switch-thumb` token: the theme `surface` is dark in the dark theme and made an "on" switch read as off.
 */
export const switchClassName =
  "focus-ring relative mt-0.5 h-[31px] w-[51px] shrink-0 cursor-pointer appearance-none rounded-full bg-separator transition-colors duration-200 checked:bg-status-confirmed disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-[2px] before:top-[2px] before:size-[27px] before:rounded-full before:bg-switch-thumb before:shadow-raised before:ring-1 before:ring-separator before:transition-transform before:duration-200 before:content-[''] checked:before:translate-x-5 motion-reduce:before:transition-none";

/**
 * Checkbox on a native input (form submission, `checked`/`defaultChecked` and keyboard stay native).
 * The browser's own box is replaced because it renders filled-black in the dark theme on iOS;
 * the tick is a rotated border on ::before, like the switch thumb above.
 */
export const checkboxClassName =
  "focus-ring relative size-6 shrink-0 cursor-pointer appearance-none rounded-[7px] border-[1.5px] border-field-border bg-surface transition-colors duration-150 checked:border-action checked:bg-action disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-[7px] before:top-[2.5px] before:h-[12px] before:w-[6.5px] before:rotate-45 before:border-b-[2.5px] before:border-r-[2.5px] before:border-on-action before:opacity-0 before:transition-opacity before:duration-150 before:content-[''] checked:before:opacity-100 motion-reduce:transition-none";

/** Inline feedback card (BoardUI Notification look). For a toned card with an icon use <Notice>. */
export const statusNote =
  "rounded-card border border-separator bg-surface p-3.5 text-subhead text-ink shadow-raised";

/** Turkish status labels (single source; always shown with the color, never color-only). */
export const appointmentStatusLabel: Record<string, string> = {
  PENDING: "Bekliyor",
  CONFIRMED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
  COMPLETED: "Tamamlandı",
};

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

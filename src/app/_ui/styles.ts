// Shared class recipes built on the semantic tokens in globals.css.
// Presentation only: none of these carry authorization or domain meaning.

export const buttonPrimary =
  "pressable focus-ring tap-target inline-flex items-center justify-center gap-2 rounded-control bg-action px-5 py-3 text-body font-semibold text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-40";

export const buttonSecondary =
  "pressable focus-ring tap-target inline-flex items-center justify-center gap-2 rounded-control border border-separator bg-surface px-4 py-2.5 text-subhead font-medium text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";

export const buttonDestructive =
  "pressable focus-ring tap-target inline-flex items-center justify-center gap-2 rounded-control bg-destructive px-5 py-3 text-body font-semibold text-on-action hover:bg-destructive-hover disabled:cursor-not-allowed disabled:opacity-40";

export const buttonDestructiveOutline =
  "pressable focus-ring tap-target inline-flex items-center justify-center gap-2 rounded-control border border-destructive/40 bg-surface px-4 py-2.5 text-subhead font-semibold text-destructive hover:bg-status-rejected-bg disabled:cursor-not-allowed disabled:opacity-40";

/** 17px text so iOS Safari does not zoom on focus. Inline variant sizes to content (toolbars). */
export const fieldInline =
  "focus-ring tap-target rounded-control border border-field-border bg-surface px-3.5 py-2.5 text-body text-ink disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted aria-[invalid=true]:border-destructive";

export const field = `w-full ${fieldInline}`;

export const card = "inset-group p-5";

export const statusNote = "rounded-control border border-separator bg-surface p-3.5 text-subhead text-ink";

export const appointmentStatusBadge: Record<string, string> = {
  PENDING: "bg-status-pending-bg text-status-pending",
  CONFIRMED: "bg-status-confirmed-bg text-status-confirmed",
  REJECTED: "bg-status-rejected-bg text-status-rejected",
  CANCELLED: "bg-status-cancelled-bg text-status-cancelled",
  COMPLETED: "bg-status-completed-bg text-status-completed",
};

export const badgeBase = "inline-flex items-center rounded-full px-2.5 py-1 text-footnote font-semibold";

"use client";

import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { MorphIcon } from "@/components/ui/motion-icons";
import { cx } from "@/lib/utils";

/**
 * Aktif / Pasif switch (Amicro btn-18 "Visibility" morph: eye ↔ eye-off).
 * role="switch" + aria-checked carries the state; the visible text always says it too
 * (never color-only). Tapping only calls `onToggle` / submits the host form: the server action
 * decides and the list re-renders from server data. Presentation only.
 */
export function StatusToggle({
  active,
  name,
  onToggle,
  type = "button",
  disabled = false,
  pending = false,
  className,
}: {
  active: boolean;
  /** Item name for the accessible label, e.g. the staff member's name. */
  name: string;
  onToggle?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={active}
      aria-label={`${name}: ${active ? "aktif" : "pasif"}`}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={onToggle}
      className={cx(
        "pressable focus-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-footnote font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-status-confirmed/30 bg-status-confirmed-bg text-status-confirmed hover:border-status-confirmed/60"
          : "border-separator bg-status-cancelled-bg text-status-cancelled hover:border-field-border",
        className,
      )}
    >
      {pending ? (
        <LoaderCircle className="size-[18px] animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        <MorphIcon icon={active ? Eye : EyeOff} iconKey={active ? "on" : "off"} className="size-[18px]" />
      )}
      <span aria-hidden="true">{active ? "Aktif" : "Pasif"}</span>
    </button>
  );
}

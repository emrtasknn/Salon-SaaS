"use client";

import { formatDateFieldLabel } from "./date-format";
import { fieldInline } from "./styles";

/**
 * Date control for toolbars. The visible part is a plain label ("10 Kas 2026") that shrinks and
 * truncates like any text; the native date input lies invisibly on top and still opens the
 * system picker. iOS gives a visible date input an intrinsic width that ignores `min-width`,
 * which pushed it under the next button on narrow phones. Presentation only.
 */
export function DateField({
  value,
  onChange,
  disabled,
  label = "Tarih",
}: {
  /** Calendar date, YYYY-MM-DD. */
  value: string;
  onChange: (date: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="relative min-w-0">
      <input
        aria-label={label}
        type="date"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        onClick={(event) => {
          // Desktop browsers only open the picker from the small calendar icon, which is invisible here.
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Not allowed or not supported: the input still works from the keyboard.
          }
        }}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={`${fieldInline} block w-full truncate tabular-nums peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-60`}
      >
        {formatDateFieldLabel(value)}
      </span>
    </div>
  );
}

"use client";

import { useState } from "react";
import { cx } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { fieldInline } from "./styles";

/**
 * Time of day as hour + quarter-hour selects (00 / 15 / 30 / 45). The chosen value is posted as
 * "HH:MM" through a hidden input named `name`, so forms keep the same contract as <input type="time">.
 * A stored minute that is not a quarter (e.g. 09:05) stays selectable so saving never changes it
 * silently. Presentation only; the server validates the value.
 */

export const QUARTER_MINUTES = [0, 15, 30, 45] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** Minute options for the select: quarters plus the current value when it is off-grid. */
export function minuteOptions(current: number): number[] {
  const options: number[] = [...QUARTER_MINUTES];
  if (!options.includes(current)) options.push(current);
  return options.sort((a, b) => a - b);
}

export function TimeSelect({
  name,
  label,
  legend = label,
  defaultMinute,
  required = false,
  disabled = false,
}: {
  name: string;
  /** Accessible name base for the selects ("… saat", "… dakika"), e.g. "Pazartesi açılış". */
  label: string;
  /** Visible group label (defaults to `label`), e.g. "Açılış". */
  legend?: string;
  /** Minutes from midnight. */
  defaultMinute: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const [hour, setHour] = useState(Math.floor(defaultMinute / 60) % 24);
  const [minute, setMinute] = useState(defaultMinute % 60);
  const selectClass = cx(fieldInline, "min-w-0 flex-1 appearance-none text-center tabular-nums");

  return (
    <fieldset className="flex min-w-0 flex-1 flex-col gap-1" disabled={disabled}>
      <legend className="mb-1 text-footnote text-ink-muted">
        <span aria-hidden={legend !== label}>{legend}</span>
        {legend !== label ? <span className="sr-only">{label}</span> : null}
      </legend>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`${label} saat`}
          value={hour}
          required={required}
          onChange={(event) => {
            setHour(Number(event.target.value));
            haptic("selection");
          }}
          className={selectClass}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {pad(h)}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="text-headline text-ink-muted">
          :
        </span>
        <select
          aria-label={`${label} dakika`}
          value={minute}
          required={required}
          onChange={(event) => {
            setMinute(Number(event.target.value));
            haptic("selection");
          }}
          className={selectClass}
        >
          {minuteOptions(defaultMinute % 60).map((m) => (
            <option key={m} value={m}>
              {pad(m)}
            </option>
          ))}
        </select>
      </div>
      <input type="hidden" name={name} value={`${pad(hour)}:${pad(minute)}`} />
    </fieldset>
  );
}

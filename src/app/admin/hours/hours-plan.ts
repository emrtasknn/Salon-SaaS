// Pure diff for the single-save working-hours form. Presentation only: each change is still sent
// through the existing per-day server actions, which validate and authorize.

export type DayHours = Readonly<{ dayOfWeek: number; openMinute: number; closeMinute: number }>;

export type DayDraft = Readonly<{ dayOfWeek: number; open: boolean; openMinute: number | null; closeMinute: number | null }>;

export type HoursChange =
  | Readonly<{ kind: "save"; dayOfWeek: number; openMinute: number; closeMinute: number }>
  | Readonly<{ kind: "close"; dayOfWeek: number }>;

export type HoursPlan =
  | Readonly<{ status: "ok"; changes: HoursChange[] }>
  | Readonly<{ status: "invalid"; dayOfWeek: number }>;

/**
 * Compares the drafted week with the saved hours and returns only what changed.
 * An open day needs a time range that ends after it starts (the server re-checks).
 */
export function planHoursChanges(saved: ReadonlyArray<DayHours>, drafts: ReadonlyArray<DayDraft>): HoursPlan {
  const changes: HoursChange[] = [];
  for (const draft of drafts) {
    const current = saved.find((item) => item.dayOfWeek === draft.dayOfWeek);
    if (!draft.open) {
      if (current) changes.push({ kind: "close", dayOfWeek: draft.dayOfWeek });
      continue;
    }
    const { openMinute, closeMinute } = draft;
    if (openMinute === null || closeMinute === null || closeMinute <= openMinute) {
      return { status: "invalid", dayOfWeek: draft.dayOfWeek };
    }
    if (!current || current.openMinute !== openMinute || current.closeMinute !== closeMinute) {
      changes.push({ kind: "save", dayOfWeek: draft.dayOfWeek, openMinute, closeMinute });
    }
  }
  return { status: "ok", changes };
}

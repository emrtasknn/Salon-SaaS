"use client";

import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { haptic } from "@/lib/haptics";
import { compactPeriodLabel, shiftWeek, showsToday, swipeDirection, weekStripDays } from "./calendar-header-model";
import { ViewSwitch, type CalendarView } from "./day-timeline";
import { stepDate, todayInZone } from "./timeline-layout";

const iconButton =
  "pressable focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";

const stepLabels: Record<CalendarView, [string, string]> = {
  day: ["Önceki gün", "Sonraki gün"],
  list: ["Önceki gün", "Sonraki gün"],
  week: ["Önceki hafta", "Sonraki hafta"],
  month: ["Önceki ay", "Sonraki ay"],
};

/** The period as a tappable title; the invisible native date input on top opens the system picker. */
function PeriodPicker({ label, date, onChange, disabled }: { label: string; date: string; onChange: (date: string) => void; disabled?: boolean }) {
  return (
    <div className="relative min-w-0">
      <input
        aria-label="Tarih seç"
        type="date"
        value={date}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // Not supported: the input still works from the keyboard.
          }
        }}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className="flex min-h-10 items-center gap-1 rounded-control px-1.5 text-headline text-ink peer-hover:bg-surface-muted peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
      >
        <span className="truncate first-letter:uppercase">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" aria-hidden />
      </span>
    </div>
  );
}

/** Mon–Sun strip for day/list views: tap a day, swipe for the previous/next week. */
function WeekStrip({ date, today, marked, onChange, disabled }: { date: string; today: string; marked: ReadonlySet<string>; onChange: (date: string) => void; disabled?: boolean }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const days = weekStripDays(date, today, marked);
  function onPointerDown(event: ReactPointerEvent) {
    start.current = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: ReactPointerEvent) {
    const from = start.current;
    start.current = null;
    if (!from || disabled) return;
    const direction = swipeDirection(event.clientX - from.x, event.clientY - from.y);
    if (direction !== 0) {
      haptic("selection");
      onChange(shiftWeek(date, direction));
    }
  }
  return (
    <div
      role="group"
      aria-label="Hafta günleri"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (start.current = null)}
      className="grid touch-pan-y grid-cols-7 gap-1"
    >
      {days.map((day) => (
        <button
          key={day.date}
          type="button"
          disabled={disabled}
          aria-pressed={day.selected}
          aria-label={`${day.weekday} ${day.dayOfMonth}${day.today ? ", bugün" : ""}${day.marked ? ", randevu var" : ""}`}
          onClick={() => {
            if (day.selected) return;
            haptic("selection");
            onChange(day.date);
          }}
          className={`pressable focus-ring flex min-h-12 flex-col items-center justify-center rounded-control text-ink disabled:opacity-60 ${
            day.selected ? "bg-action text-on-action" : "hover:bg-surface-muted"
          }`}
        >
          <span className={`text-caption font-semibold ${day.selected ? "" : "text-ink-muted"}`}>{day.weekday}</span>
          <span className={`text-headline tabular-nums ${day.today && !day.selected ? "text-accent-ink" : ""}`}>{day.dayOfMonth}</span>
          <span
            aria-hidden="true"
            className={`mt-0.5 size-1 rounded-full ${day.marked ? (day.selected ? "bg-on-action" : "bg-ink-muted") : "bg-transparent"}`}
          />
        </button>
      ))}
    </div>
  );
}

export type OverflowAction = Readonly<{ label: string; onSelect: () => void; disabled?: boolean }>;

/** "⋯" button with a short action list. Closes on choice, outside tap and Escape. */
export function OverflowMenu({ actions, label = "Diğer işlemler" }: { actions: readonly OverflowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`${iconButton} border border-separator bg-surface`}
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          className="dialog-motion absolute right-0 top-full z-40 mt-2 min-w-48 overflow-hidden rounded-card border border-separator bg-surface py-1 shadow-sheet"
        >
          {actions.map((action) => (
            <li key={action.label} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
                className="focus-ring flex min-h-11 w-full items-center px-4 text-left text-body text-ink hover:bg-surface-muted disabled:opacity-50 [outline-offset:-2px]"
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Compact sticky header for calendar screens: period title with ‹ › and date picker, Bugün, the
 * bell and a ⋯ menu on one row; the view switch under it; a week strip for day/list views.
 * Replaces the large-title PageHeader on calendars. Presentation only.
 */
export function CalendarHeader({
  title,
  view,
  onViewChange,
  date,
  onDateChange,
  marked,
  disabled,
  busy,
  accessory,
  menu,
}: {
  /** Screen name, read by screen readers (the visible title is the period). */
  title: string;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Dates with at least one live appointment (dots in the week strip). */
  marked: ReadonlySet<string>;
  disabled?: boolean;
  busy?: boolean;
  accessory?: ReactNode;
  menu?: ReactNode;
}) {
  const today = todayInZone();
  const [previousLabel, nextLabel] = stepLabels[view];
  const atToday = showsToday(view, date, today);
  return (
    <header data-page-header data-calendar-header="" className="glass safe-top sticky top-0 z-30 border-b pb-2">
      <div className="mx-auto w-full max-w-5xl px-3 sm:px-6">
        <h1 className="sr-only">{title}</h1>
        <div className="flex items-center gap-1 pt-2">
          <button type="button" aria-label={previousLabel} disabled={disabled} onClick={() => { haptic("selection"); onDateChange(stepDate(view, date, -1)); }} className={iconButton}>
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <div className="min-w-0 flex-1" aria-live="polite">
            <PeriodPicker label={compactPeriodLabel(view, date, today)} date={date} onChange={onDateChange} disabled={disabled} />
          </div>
          <button type="button" aria-label={nextLabel} disabled={disabled} onClick={() => { haptic("selection"); onDateChange(stepDate(view, date, 1)); }} className={iconButton}>
            <ChevronRight className="size-5" aria-hidden />
          </button>
          {!atToday ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => { haptic("selection"); onDateChange(today); }}
              className="pressable focus-ring inline-flex min-h-9 shrink-0 items-center rounded-full border border-separator bg-surface px-3 text-subhead font-semibold text-ink hover:bg-surface-muted disabled:opacity-40"
            >
              Bugün
            </button>
          ) : null}
          {accessory ? <div className="flex shrink-0 items-center">{accessory}</div> : null}
          {menu}
        </div>
        <div className="mt-2">
          <ViewSwitch view={view} onChange={onViewChange} compact />
        </div>
        {view === "day" || view === "list" ? (
          <div className="mt-2">
            <WeekStrip date={date} today={today} marked={marked} onChange={onDateChange} disabled={disabled} />
          </div>
        ) : null}
      </div>
      {busy ? <span data-header-progress="" aria-hidden="true" className="header-progress" /> : null}
    </header>
  );
}

"use client";

// Day timeline ("Zaman çizelgesi"): a read-only, Gantt-like view of one day's appointments.
// Presentation only. Bars open a detail sheet; every action inside it calls the same
// server actions as the list view, and the server stays authoritative.

import { useEffect, useId, useMemo, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { appointmentStatusBadge, buttonSecondary } from "./styles";
import {
  addDays,
  assignLanes,
  computeRange,
  formatMinute,
  initialScrollMinute,
  minutesFromDayStart,
  minuteToPct,
  placeInterval,
  ticks,
  TIMELINE_TIME_ZONE,
  todayInZone,
  type MinuteRange,
} from "./timeline-layout";

export const appointmentStatusLabels: Record<string, string> = {
  PENDING: "Bekliyor",
  CONFIRMED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
  COMPLETED: "Tamamlandı",
};

export type TimelineRow = Readonly<{ id: string; label: string }>;

export type TimelineItem = Readonly<{
  id: string;
  rowId: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
  customer: string;
  service: string;
}>;

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIMELINE_TIME_ZONE,
});

export function formatTimeRange(startAt: Date | string, endAt: Date | string) {
  return `${timeFormatter.format(new Date(startAt))}–${timeFormatter.format(new Date(endAt))}`;
}

/* ------------------------------------------------------------------------------------------ */
/* View switch (Çizelge | Liste), remembered per device.                                       */
/* ------------------------------------------------------------------------------------------ */

export type CalendarView = "timeline" | "list";
const VIEW_STORAGE_KEY = "salon-saas.calendar-view";

const viewListeners = new Set<() => void>();
/** In-memory choice for this page view; survives even when storage is unavailable. */
let chosenView: CalendarView | null = null;

function readView(): CalendarView {
  if (chosenView) return chosenView;
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "timeline";
  } catch {
    return "timeline"; // Storage unavailable (private mode, blocked): keep the default.
  }
}

function subscribeView(onChange: () => void) {
  viewListeners.add(onChange);
  return () => {
    viewListeners.delete(onChange);
  };
}

export function useCalendarView(): [CalendarView, (view: CalendarView) => void] {
  const view = useSyncExternalStore(subscribeView, readView, () => "timeline" as const);
  function update(next: CalendarView) {
    chosenView = next;
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Ignore: the choice just won't persist across visits.
    }
    viewListeners.forEach((listener) => listener());
  }
  return [view, update];
}

export function ViewSwitch({ view, onChange }: { view: CalendarView; onChange: (view: CalendarView) => void }) {
  const options: Array<{ value: CalendarView; label: string }> = [
    { value: "timeline", label: "Çizelge" },
    { value: "list", label: "Liste" },
  ];
  return (
    <div role="group" aria-label="Görünüm" className="inline-flex rounded-control bg-separator/70 p-0.5">
      {options.map((option) => {
        const selected = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`pressable focus-ring tap-target rounded-[10px] px-4 text-subhead font-semibold ${
              selected ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Date stepper (‹ Bugün ›) around the existing native date input.                             */
/* ------------------------------------------------------------------------------------------ */

const stepButton =
  "pressable focus-ring tap-target inline-flex items-center justify-center rounded-control border border-separator bg-surface text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";

export function DateStepper({
  date,
  onChange,
  disabled,
  children,
}: {
  date: string;
  onChange: (date: string) => void;
  disabled?: boolean;
  /** The existing date input, kept between the arrows. */
  children: ReactNode;
}) {
  const today = todayInZone();
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" aria-label="Önceki gün" disabled={disabled} onClick={() => onChange(addDays(date, -1))} className={stepButton}>
        <span aria-hidden="true" className="text-headline">‹</span>
      </button>
      {children}
      <button type="button" aria-label="Sonraki gün" disabled={disabled} onClick={() => onChange(addDays(date, 1))} className={stepButton}>
        <span aria-hidden="true" className="text-headline">›</span>
      </button>
      <button
        type="button"
        disabled={disabled || date === today}
        onClick={() => onChange(today)}
        className={`${stepButton} px-3.5 text-subhead font-medium`}
      >
        Bugün
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Timeline                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const LANE_HEIGHT_PX = 52; // 44px bar + 8px gap: keeps every bar a 44px touch target.
const ROW_PADDING_PX = 4;

function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
}

/** Stable within a minute so useSyncExternalStore only re-renders when the minute changes. */
function readNowKey() {
  const current = new Date();
  const today = todayInZone(TIMELINE_TIME_ZONE, current);
  return `${today}|${minutesFromDayStart(current, today)}`;
}

/** Current wall minute when `date` is today in the tenant zone; null otherwise (and on the server). */
function useNowMinute(date: string) {
  const key = useSyncExternalStore(subscribeMinute, readNowKey, () => null);
  if (!key) return null;
  const [today, minute] = key.split("|");
  return today === date ? Number(minute) : null;
}

function Gridlines({ range }: { range: MinuteRange }) {
  return (
    <>
      {ticks(range).map((tick) => (
        <span
          key={tick.minute}
          aria-hidden="true"
          className={`absolute inset-y-0 w-px ${tick.kind === "hour" ? "bg-separator" : "bg-separator/50"}`}
          style={{ left: `${minuteToPct(tick.minute, range)}%` }}
        />
      ))}
    </>
  );
}

function NowLine({ pct, withLabel }: { pct: number; withLabel?: boolean }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[5] w-0.5 -translate-x-1/2 bg-destructive" style={{ left: `${pct}%` }}>
      {withLabel && (
        <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-full bg-destructive px-1.5 text-caption font-semibold text-on-action">
          Şimdi
        </span>
      )}
    </span>
  );
}

const statusBarExtra: Record<string, string> = {
  PENDING: "border border-dashed border-status-pending",
  CONFIRMED: "border border-status-confirmed/40",
  COMPLETED: "border border-status-completed/30",
  REJECTED: "border border-status-rejected/30",
  CANCELLED: "border border-status-cancelled/30",
};

export function DayTimeline({
  date,
  rows,
  items,
  onSelect,
  rowHeaderLabel = "Personel",
}: {
  date: string;
  rows: ReadonlyArray<TimelineRow>;
  items: ReadonlyArray<TimelineItem>;
  onSelect: (id: string, trigger: HTMLElement) => void;
  rowHeaderLabel?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const nowMinute = useNowMinute(date);

  const placed = useMemo(
    () =>
      items.map((item) => ({
        item,
        startMin: minutesFromDayStart(item.startAt, date),
        endMin: minutesFromDayStart(item.endAt, date),
      })),
    [items, date],
  );
  const range = useMemo(() => computeRange(placed), [placed]);
  const hours = (range.endMin - range.startMin) / 60;

  const rowLayouts = useMemo(
    () =>
      rows.map((row) => {
        const rowItems = placed.filter((p) => p.item.rowId === row.id);
        const { lanes, laneCount } = assignLanes(rowItems.map((p) => ({ id: p.item.id, startMin: p.startMin, endMin: p.endMin })));
        return { row, rowItems, lanes, laneCount };
      }),
    [rows, placed],
  );

  const firstStart = placed.length ? Math.min(...placed.map((p) => p.startMin)) : null;
  const scrollMinute = initialScrollMinute(range, firstStart, nowMinute);
  const hasNow = nowMinute !== null;

  // Bring the current hour (or first appointment) into view on day change; instant, no animation.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const track = scroller.querySelector<HTMLElement>("[data-timeline-track]");
    if (!track) return;
    const fraction = (scrollMinute - range.startMin) / (range.endMin - range.startMin);
    // Land the target hour just right of the sticky staff column (instant: no motion).
    scroller.scrollLeft = Math.max(0, fraction * track.getBoundingClientRect().width - 16);
    // Only on day/data change, not on every minute tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, range.startMin, range.endMin, hasNow, firstStart]);

  const nowPct = nowMinute !== null ? minuteToPct(nowMinute, range) : null;

  return (
    <section aria-labelledby={captionId} className="inset-group">
      <h2 id={captionId} className="sr-only">
        Zaman çizelgesi
      </h2>
      <div ref={scrollerRef} className="max-h-[70dvh] overflow-auto overscroll-x-contain">
        <div
          className="min-w-[calc(7.5rem+var(--tl-hours)*8rem)] lg:min-w-0"
          style={{ "--tl-hours": hours } as CSSProperties}
        >
          {/* Hour header: sticky to the top of the scroller. */}
          <div className="sticky top-0 z-20 flex border-b border-separator bg-surface">
            <div className="sticky left-0 z-10 flex w-[7.5rem] shrink-0 items-end bg-surface px-3 pb-1.5 text-footnote font-medium text-ink-muted">
              {rowHeaderLabel}
            </div>
            <div data-timeline-track className="relative h-9 flex-1" aria-hidden="true">
              {ticks(range).map((tick) => {
                const pct = minuteToPct(tick.minute, range) ?? 0;
                if (tick.kind === "half") {
                  return <span key={tick.minute} className="absolute bottom-0 h-1.5 w-px bg-separator" style={{ left: `${pct}%` }} />;
                }
                const last = tick.minute === range.endMin;
                return (
                  <span key={tick.minute} className="absolute inset-y-0" style={{ left: `${pct}%` }}>
                    <span className="absolute bottom-0 h-2.5 w-px bg-field-border/60" />
                    {!last && (
                      <span className="absolute bottom-2.5 left-1 whitespace-nowrap text-footnote tabular-nums text-ink-muted">
                        {formatMinute(tick.minute)}
                      </span>
                    )}
                  </span>
                );
              })}
              {nowPct !== null && <NowLine pct={nowPct} withLabel />}
            </div>
          </div>

          <ul>
            {rowLayouts.map(({ row, rowItems, lanes, laneCount }) => (
              <li key={row.id} className="flex border-b border-separator last:border-b-0">
                <div className="sticky left-0 z-10 flex w-[7.5rem] shrink-0 items-start border-r border-separator bg-surface px-3 py-3">
                  <span className="line-clamp-2 break-words text-subhead font-semibold text-ink">{row.label}</span>
                </div>
                <div className="relative flex-1" style={{ height: laneCount * LANE_HEIGHT_PX + ROW_PADDING_PX * 2 }}>
                  <Gridlines range={range} />
                  {nowPct !== null && <NowLine pct={nowPct} />}
                  <ul aria-label={`${row.label} randevuları`}>
                    {rowItems.map(({ item, startMin, endMin }) => {
                      const { leftPct, widthPct } = placeInterval({ startMin, endMin }, range);
                      const lane = lanes.get(item.id) ?? 0;
                      const label = appointmentStatusLabels[item.status] ?? item.status;
                      const time = formatTimeRange(item.startAt, item.endAt);
                      const inactive = item.status === "REJECTED" || item.status === "CANCELLED";
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={(event) => onSelect(item.id, event.currentTarget)}
                            aria-label={`${time}, ${item.customer}, ${item.service}, ${label}. Ayrıntıları aç`}
                            className={`focus-ring absolute z-[6] flex h-11 min-w-11 flex-col justify-center overflow-hidden rounded-[10px] px-2 text-left transition-[filter] duration-150 hover:brightness-[0.97] focus-visible:z-[7] motion-reduce:transition-none ${
                              appointmentStatusBadge[item.status] ?? "bg-surface-muted text-ink"
                            } ${statusBarExtra[item.status] ?? "border border-separator"}`}
                            style={{
                              left: `${leftPct}%`,
                              width: `max(2.75rem, calc(${widthPct}% - 2px))`,
                              top: ROW_PADDING_PX + lane * LANE_HEIGHT_PX,
                            }}
                          >
                            <span aria-hidden="true" className="block w-full truncate text-caption font-semibold tabular-nums">
                              {time} · {label}
                            </span>
                            <span aria-hidden="true" className={`block w-full truncate text-footnote ${inactive ? "line-through" : ""}`}>
                              {item.customer} · {item.service}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Detail sheet: bottom sheet on phones, centered dialog from sm up. Esc closes (native).      */
/* ------------------------------------------------------------------------------------------ */

export function AppointmentSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      headingRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // Tap on the backdrop closes the sheet.
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
      className="sheet-motion mx-0 mb-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-sheet border-0 bg-surface p-0 text-ink shadow-sheet backdrop:bg-black/40 sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:rounded-sheet"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-separator bg-surface px-4 py-3">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-headline tabular-nums focus:outline-none">
          {title}
        </h2>
        <button type="button" onClick={() => dialogRef.current?.close()} className={buttonSecondary}>
          Kapat
        </button>
      </div>
      <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">{children}</div>
    </dialog>
  );
}

/** Label/value rows for the sheet. */
export function DetailList({ entries }: { entries: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
      {entries.map((entry) => (
        <div key={entry.label} className="contents">
          <dt className="text-ink-muted">{entry.label}</dt>
          <dd className="min-w-0 break-words text-ink">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

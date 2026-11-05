"use client";

// Calendar views shared by the admin and staff calendars: view switch (Gün | Hafta | Ay | Liste),
// date stepper, the vertical time grid (Day and Week), and the appointment detail sheet.
// Presentation only. Bars open a detail sheet; every action inside it calls the same server
// actions as the list view, and the server stays authoritative.

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import { appointmentStatusBadge } from "./styles";
import {
  computeRange,
  formatMinute,
  initialScrollMinute,
  layoutColumn,
  minutesFromDayStart,
  placeVertical,
  stepDate,
  ticks,
  TIMELINE_TIME_ZONE,
  todayInZone,
  viewDateRange,
  weekDates,
  type CalendarViewKind,
  type MinuteRange,
} from "./timeline-layout";
import { Button } from "@/components/ui/button";

export const appointmentStatusLabels: Record<string, string> = {
  PENDING: "Bekliyor",
  CONFIRMED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
  COMPLETED: "Tamamlandı",
};

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIMELINE_TIME_ZONE,
});

export function formatTimeRange(startAt: Date | string, endAt: Date | string) {
  return `${timeFormatter.format(new Date(startAt))}–${timeFormatter.format(new Date(endAt))}`;
}

/** Calendar-date formatting (dates are wall dates, so format them in UTC to avoid shifts). */
function formatIsoDate(dateIso: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("tr-TR", { ...options, timeZone: "UTC" }).format(new Date(`${dateIso}T12:00:00.000Z`));
}

export function formatLongDate(dateIso: string) {
  return formatIsoDate(dateIso, { day: "numeric", month: "long", year: "numeric", weekday: "long" });
}

/** Heading for the visible period: "5 Kasım 2026 Perşembe", "2–8 Kasım 2026", "Kasım 2026". */
export function formatPeriod(view: CalendarView, dateIso: string) {
  if (view === "month") return formatIsoDate(dateIso, { month: "long", year: "numeric" });
  if (view === "week") {
    const days = weekDates(dateIso);
    const first = days[0];
    const last = days[6];
    const sameMonth = first.slice(0, 7) === last.slice(0, 7);
    const sameYear = first.slice(0, 4) === last.slice(0, 4);
    const start = formatIsoDate(first, sameMonth ? { day: "numeric" } : sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
    return `${start}–${formatIsoDate(last, { day: "numeric", month: "long", year: "numeric" })}`;
  }
  return formatLongDate(dateIso);
}

/* ------------------------------------------------------------------------------------------ */
/* View switch (Gün | Hafta | Ay | Liste), remembered per device.                              */
/* ------------------------------------------------------------------------------------------ */

export type CalendarView = CalendarViewKind;
const VIEW_STORAGE_KEY = "salon-saas.calendar-view";
const VIEWS: ReadonlyArray<CalendarView> = ["day", "week", "month", "list"];

const viewListeners = new Set<() => void>();
/** In-memory choice for this page view; survives even when storage is unavailable. */
let chosenView: CalendarView | null = null;

/** Stored value to view; the earlier "timeline" choice maps to the Day view. */
export function parseStoredView(value: string | null): CalendarView {
  if (value === "timeline") return "day";
  return VIEWS.includes(value as CalendarView) ? (value as CalendarView) : "day";
}

function readView(): CalendarView {
  if (chosenView) return chosenView;
  try {
    return parseStoredView(window.localStorage.getItem(VIEW_STORAGE_KEY));
  } catch {
    return "day"; // Storage unavailable (private mode, blocked): keep the default.
  }
}

function subscribeView(onChange: () => void) {
  viewListeners.add(onChange);
  return () => {
    viewListeners.delete(onChange);
  };
}

export function useCalendarView(): [CalendarView, (view: CalendarView) => void] {
  const view = useSyncExternalStore(subscribeView, readView, () => "day" as const);
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

const viewLabels: Record<CalendarView, string> = { day: "Gün", week: "Hafta", month: "Ay", list: "Liste" };

export function ViewSwitch({ view, onChange }: { view: CalendarView; onChange: (view: CalendarView) => void }) {
  return (
    <div role="group" aria-label="Görünüm" className="inline-flex rounded-control bg-separator/70 p-0.5">
      {VIEWS.map((value) => {
        const selected = view === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(value)}
            className={`pressable focus-ring tap-target rounded-[10px] px-3.5 text-subhead font-semibold sm:px-4 ${
              selected ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink"
            }`}
          >
            {viewLabels[value]}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Range data: reloads whenever the visible range (view + anchor date) changes.                */
/* ------------------------------------------------------------------------------------------ */

/**
 * Keeps the loader result for the visible range. `refresh()` reloads the same range; a newer
 * request always wins over a slower older one. `stale` is true while the shown data belongs to
 * another range (e.g. right after switching Day → Week).
 */
export function useCalendarData<T>(
  load: (startDate: string, endDate: string) => Promise<T>,
  view: CalendarView,
  date: string,
  initial: Readonly<{ startDate: string; endDate: string; data: T }>,
) {
  const range = viewDateRange(view, date);
  const key = `${range.startDate}|${range.endDate}`;
  const [state, setState] = useState({ key: `${initial.startDate}|${initial.endDate}`, token: 0, data: initial.data });
  const [token, setToken] = useState(0);
  const [busy, startTransition] = useTransition();
  const requestRef = useRef(0);

  useEffect(() => {
    if (state.key === key && state.token === token) return;
    const request = ++requestRef.current;
    startTransition(async () => {
      const data = await load(range.startDate, range.endDate);
      if (request !== requestRef.current) return;
      startTransition(() => setState({ key, token, data }));
    });
    // Load only when the range or the refresh token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token]);

  return {
    data: state.data,
    stale: state.key !== key,
    busy,
    refresh: () => setToken((value) => value + 1),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Date stepper (‹ Bugün ›) around the existing native date input; steps by the view's unit.  */
/* ------------------------------------------------------------------------------------------ */

const stepButton =
  "pressable focus-ring tap-target inline-flex items-center justify-center rounded-control border border-separator bg-surface text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";

const stepLabels: Record<CalendarView, [string, string]> = {
  day: ["Önceki gün", "Sonraki gün"],
  list: ["Önceki gün", "Sonraki gün"],
  week: ["Önceki hafta", "Sonraki hafta"],
  month: ["Önceki ay", "Sonraki ay"],
};

export function DateStepper({
  date,
  view = "day",
  onChange,
  disabled,
  children,
}: {
  date: string;
  view?: CalendarView;
  onChange: (date: string) => void;
  disabled?: boolean;
  /** The existing date input, kept between the arrows. */
  children: ReactNode;
}) {
  const today = todayInZone();
  const [previousLabel, nextLabel] = stepLabels[view];
  const showsToday = viewDateRange(view, date);
  const todayVisible = today >= showsToday.startDate && today <= showsToday.endDate && (view !== "month" || today.slice(0, 7) === date.slice(0, 7));
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" aria-label={previousLabel} disabled={disabled} onClick={() => onChange(stepDate(view, date, -1))} className={stepButton}>
        <span aria-hidden="true" className="text-headline">‹</span>
      </button>
      {children}
      <button type="button" aria-label={nextLabel} disabled={disabled} onClick={() => onChange(stepDate(view, date, 1))} className={stepButton}>
        <span aria-hidden="true" className="text-headline">›</span>
      </button>
      <button
        type="button"
        disabled={disabled || date === today || (view !== "day" && view !== "list" && todayVisible)}
        onClick={() => onChange(today)}
        className={`${stepButton} px-3.5 text-subhead font-medium`}
      >
        Bugün
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Vertical time grid: hours on Y, one column per staff (Day) or per date (Week).              */
/* ------------------------------------------------------------------------------------------ */

/** 30 minutes = 44px, so a half-hour appointment is exactly one touch target tall. */
export const HOUR_PX = 88;
const MIN_BAR_PX = 44;
const MIN_BAR_MINUTES = (MIN_BAR_PX / HOUR_PX) * 60;
const GRID_PAD_PX = 10; // keeps the first and last hour labels inside the scroller

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

/** Today's date and wall minute in the tenant zone; null on the server. */
function useNow(): { today: string; minute: number } | null {
  const key = useSyncExternalStore(subscribeMinute, readNowKey, () => null);
  if (!key) return null;
  const [today, minute] = key.split("|");
  return { today, minute: Number(minute) };
}

export type GridColumn = Readonly<{
  id: string;
  /** Wall date (YYYY-MM-DD) the column's minutes are measured from. */
  date: string;
  label: string;
  sublabel?: string;
  /** Emphasised header (today in the week view). */
  highlight?: boolean;
  /** Makes the header a button (week view: open that day). */
  onHeaderClick?: () => void;
  headerAriaLabel?: string;
}>;

export type GridItem = Readonly<{
  id: string;
  columnId: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
  /** First line, e.g. customer name. */
  title: string;
  /** Second line, e.g. service or staff. */
  detail: string;
  /** Extra words for the accessible name, e.g. staff name in the week view. */
  ariaExtra?: string;
  /** Fill classes; defaults to the status colors. */
  colorClass?: string;
}>;

const statusBarExtra: Record<string, string> = {
  PENDING: "border border-dashed border-status-pending",
  CONFIRMED: "border border-status-confirmed/40",
  COMPLETED: "border border-status-completed/30",
  REJECTED: "border border-status-rejected/30",
  CANCELLED: "border border-status-cancelled/30",
};

export function TimeGrid({
  caption,
  cornerLabel,
  columns,
  items,
  onSelect,
  minColumnRem = 9,
}: {
  caption: string;
  cornerLabel?: string;
  columns: ReadonlyArray<GridColumn>;
  items: ReadonlyArray<GridItem>;
  onSelect: (id: string, trigger: HTMLElement) => void;
  minColumnRem?: number;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const now = useNow();

  const columnDates = useMemo(() => new Map(columns.map((column) => [column.id, column.date])), [columns]);
  const placed = useMemo(
    () =>
      items.flatMap((item) => {
        const date = columnDates.get(item.columnId);
        if (!date) return [];
        return [{ item, startMin: minutesFromDayStart(item.startAt, date), endMin: minutesFromDayStart(item.endAt, date) }];
      }),
    [items, columnDates],
  );
  const range: MinuteRange = useMemo(() => computeRange(placed), [placed]);
  const bodyHeight = ((range.endMin - range.startMin) / 60) * HOUR_PX + GRID_PAD_PX * 2;

  const columnLayouts = useMemo(
    () =>
      columns.map((column) => {
        const columnItems = placed.filter((p) => p.item.columnId === column.id);
        const lanes = layoutColumn(
          columnItems.map((p) => ({ id: p.item.id, startMin: p.startMin, endMin: p.endMin })),
          MIN_BAR_MINUTES,
        );
        return { column, columnItems, lanes };
      }),
    [columns, placed],
  );

  const multiDate = new Set(columns.map((column) => column.date)).size > 1;
  const isNowColumn = (column: GridColumn) => now !== null && column.date === now.today;
  // Week: highlight and scroll to today's column. Day: every column is the same date.
  const todayColumn = multiDate && now ? columns.findIndex((column) => column.date === now.today) : -1;
  const nowMinute = now && columns.some(isNowColumn) ? now.minute : null;
  const nowVisible = nowMinute !== null && nowMinute >= range.startMin && nowMinute <= range.endMin;
  const firstStart = placed.length ? Math.min(...placed.map((p) => p.startMin)) : null;
  const scrollMinute = initialScrollMinute(range, firstStart, nowMinute);
  const scrollKey = `${columns.map((c) => c.id).join(",")}|${range.startMin}|${range.endMin}|${scrollMinute}|${todayColumn}`;

  // Bring the current hour (or first appointment) and today's column into view; instant, no motion.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = Math.max(0, GRID_PAD_PX + ((scrollMinute - range.startMin) / 60) * HOUR_PX - 8);
    const today = scroller.querySelector<HTMLElement>("[data-today-column]");
    const gutter = scroller.querySelector<HTMLElement>("[data-hour-gutter]");
    if (today && gutter) {
      const left = today.offsetLeft - gutter.offsetWidth;
      if (left + today.offsetWidth > scroller.scrollLeft + scroller.clientWidth || left < scroller.scrollLeft) {
        scroller.scrollLeft = Math.max(0, left);
      }
    }
    // Only when the layout changes, not on every minute tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const nowTop = nowVisible && nowMinute !== null ? GRID_PAD_PX + ((nowMinute - range.startMin) / 60) * HOUR_PX : null;

  return (
    <section aria-labelledby={captionId} className="inset-group">
      <h2 id={captionId} className="sr-only">
        {caption}
      </h2>
      <div ref={scrollerRef} className="max-h-[70dvh] overflow-auto overscroll-contain">
        <div style={{ minWidth: `calc(3.5rem + ${columns.length} * ${minColumnRem}rem)` } as CSSProperties}>
          {/* Column headers: sticky to the top of the scroller. */}
          <div className="sticky top-0 z-20 flex border-b border-separator bg-surface">
            <div className="sticky left-0 z-10 flex w-14 shrink-0 items-end bg-surface px-2 pb-2 text-caption font-medium text-ink-muted">
              {cornerLabel}
            </div>
            {columns.map((column) => {
              const content = (
                <>
                  <span className="block truncate text-subhead font-semibold text-ink">{column.label}</span>
                  {column.sublabel && (
                    <span
                      className={`mx-auto mt-0.5 inline-flex min-w-7 items-center justify-center rounded-full px-1.5 text-footnote tabular-nums ${
                        column.highlight ? "bg-action font-semibold text-on-action" : "text-ink-muted"
                      }`}
                    >
                      {column.sublabel}
                    </span>
                  )}
                </>
              );
              return (
                <div
                  key={column.id}
                  className="flex-1 basis-0 border-l border-separator"
                  style={{ minWidth: `${minColumnRem}rem` }}
                >
                  {column.onHeaderClick ? (
                    <button
                      type="button"
                      onClick={column.onHeaderClick}
                      aria-label={column.headerAriaLabel}
                      className="focus-ring tap-target flex w-full flex-col items-center justify-center px-2 py-1.5 text-center hover:bg-surface-muted"
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="flex min-h-11 flex-col items-center justify-center px-2 py-1.5 text-center">{content}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="relative flex" style={{ height: bodyHeight }}>
            {/* Hour gutter: sticky to the left edge. */}
            <div data-hour-gutter className="sticky left-0 z-10 w-14 shrink-0 border-r border-separator bg-surface" aria-hidden="true">
              {ticks(range).map((tick) =>
                tick.kind === "hour" ? (
                  <span
                    key={tick.minute}
                    className="absolute right-2 -translate-y-1/2 text-caption tabular-nums text-ink-muted"
                    style={{ top: GRID_PAD_PX + ((tick.minute - range.startMin) / 60) * HOUR_PX }}
                  >
                    {formatMinute(tick.minute)}
                  </span>
                ) : null,
              )}
              {nowTop !== null && nowMinute !== null && (
                <span
                  className="absolute right-1 z-[1] -translate-y-1/2 rounded-full bg-destructive px-1.5 text-caption font-semibold tabular-nums text-on-action"
                  style={{ top: nowTop }}
                >
                  {formatMinute(nowMinute)}
                </span>
              )}
            </div>

            {columnLayouts.map(({ column, columnItems, lanes }, index) => (
              <div
                key={column.id}
                data-today-column={index === todayColumn ? "" : undefined}
                className={`relative flex-1 basis-0 border-l border-separator ${index === todayColumn ? "bg-surface-muted/60" : ""}`}
                style={{ minWidth: `${minColumnRem}rem` }}
              >
                {ticks(range).map((tick) => (
                  <span
                    key={tick.minute}
                    aria-hidden="true"
                    className={`absolute inset-x-0 h-px ${tick.kind === "hour" ? "bg-separator" : "bg-separator/50"}`}
                    style={{ top: GRID_PAD_PX + ((tick.minute - range.startMin) / 60) * HOUR_PX }}
                  />
                ))}
                {nowTop !== null && isNowColumn(column) && (
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[5] h-0.5 -translate-y-1/2 bg-destructive" style={{ top: nowTop }}>
                    {(index === 0 || multiDate) && <span className="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-destructive" />}
                  </span>
                )}
                <ul aria-label={`${column.label}${column.sublabel ? ` ${column.sublabel}` : ""} randevuları`}>
                  {columnItems.map(({ item, startMin, endMin }) => {
                    const { top, height } = placeVertical({ startMin, endMin }, range, HOUR_PX, MIN_BAR_PX);
                    const { lane, laneCount } = lanes.get(item.id) ?? { lane: 0, laneCount: 1 };
                    const label = appointmentStatusLabels[item.status] ?? item.status;
                    const time = formatTimeRange(item.startAt, item.endAt);
                    const inactive = item.status === "REJECTED" || item.status === "CANCELLED";
                    const fill = item.colorClass
                      ? `${item.colorClass} border-l-4 text-ink ${item.status === "PENDING" ? "border-y border-r border-dashed border-y-status-pending border-r-status-pending" : ""}`
                      : `${appointmentStatusBadge[item.status] ?? "bg-surface-muted text-ink"} ${statusBarExtra[item.status] ?? "border border-separator"}`;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={(event) => onSelect(item.id, event.currentTarget)}
                          aria-label={`${time}, ${item.title}, ${item.detail}${item.ariaExtra ? `, ${item.ariaExtra}` : ""}, ${label}. Ayrıntıları aç`}
                          className={`focus-ring absolute z-[6] flex min-w-11 flex-col items-start overflow-hidden rounded-[10px] px-2 py-1 text-left transition-[filter] duration-150 hover:brightness-[0.97] focus-visible:z-[7] motion-reduce:transition-none ${fill} ${
                            inactive ? "opacity-80" : ""
                          }`}
                          style={{
                            top: GRID_PAD_PX + top + 1,
                            height: height - 2,
                            left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                            width: `calc(${100 / laneCount}% - 4px)`,
                          }}
                        >
                          <span aria-hidden="true" className="block w-full truncate text-caption font-semibold tabular-nums">
                            {time} · {label}
                          </span>
                          <span aria-hidden="true" className={`block w-full truncate text-footnote font-medium ${inactive ? "line-through" : ""}`}>
                            {item.title}
                          </span>
                          <span aria-hidden="true" className="block w-full truncate text-caption">
                            {item.detail}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Day view: one column per staff member.                                                      */
/* ------------------------------------------------------------------------------------------ */

export type TimelineColumn = Readonly<{ id: string; label: string }>;

export type TimelineItem = Readonly<{
  id: string;
  /** Staff column id. */
  rowId: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
  customer: string;
  service: string;
}>;

export function DayTimeline({
  date,
  rows,
  items,
  onSelect,
}: {
  date: string;
  /** One column per staff member. */
  rows: ReadonlyArray<TimelineColumn>;
  items: ReadonlyArray<TimelineItem>;
  onSelect: (id: string, trigger: HTMLElement) => void;
}) {
  const columns = useMemo(() => rows.map((row) => ({ id: row.id, date, label: row.label })), [rows, date]);
  const gridItems = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        columnId: item.rowId,
        startAt: item.startAt,
        endAt: item.endAt,
        status: item.status,
        title: item.customer,
        detail: item.service,
      })),
    [items],
  );
  return <TimeGrid caption={`${formatLongDate(date)} gün görünümü`} columns={columns} items={gridItems} onSelect={onSelect} minColumnRem={rows.length > 1 ? 9 : 12} />;
}

/* ------------------------------------------------------------------------------------------ */
/* Sheet: bottom sheet on phones, centered dialog from sm (or md for wide content).            */
/* Esc closes (native <dialog>).                                                               */
/* ------------------------------------------------------------------------------------------ */

export function AppointmentSheet({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Larger content (closures form): bottom sheet below 768px, dialog from md up. */
  wide?: boolean;
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
      className={
        wide
          ? "sheet-motion mx-0 mb-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-sheet border-0 bg-surface p-0 text-ink shadow-sheet backdrop:bg-black/40 md:m-auto md:w-[calc(100%-2rem)] md:max-w-xl md:rounded-sheet"
          : "sheet-motion mx-0 mb-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-sheet border-0 bg-surface p-0 text-ink shadow-sheet backdrop:bg-black/40 sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:rounded-sheet"
      }
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-separator bg-surface px-4 py-3">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-headline tabular-nums focus:outline-none">
          {title}
        </h2>
        <Button type="button" onClick={() => dialogRef.current?.close()} variant="secondary">
          Kapat
        </Button>
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

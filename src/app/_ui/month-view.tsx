"use client";

// Month view: Mon–Sun grid with the appointment count and status dots per day, closure days
// marked. Tapping a day opens the Day view of that date. Presentation only.

import { appointmentStatusDot } from "./styles";
import { appointmentStatusLabels, formatLongDate } from "./day-timeline";
import { dateInZone, monthGrid, todayInZone } from "./timeline-layout";

const weekdayHeaders = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const statusOrder = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "REJECTED"];

export type MonthItem = Readonly<{ startAt: Date | string; status: string }>;

/** Per local date: total and per-status counts. */
export function countByDay(items: ReadonlyArray<MonthItem>) {
  const days = new Map<string, { total: number; byStatus: Map<string, number> }>();
  for (const item of items) {
    const day = dateInZone(item.startAt);
    const entry = days.get(day) ?? { total: 0, byStatus: new Map<string, number>() };
    entry.total += 1;
    entry.byStatus.set(item.status, (entry.byStatus.get(item.status) ?? 0) + 1);
    days.set(day, entry);
  }
  return days;
}

export function MonthView({
  date,
  items,
  closedDates,
  onOpenDay,
}: {
  date: string;
  items: ReadonlyArray<MonthItem>;
  /** Tenant closure dates (YYYY-MM-DD); empty when not available to this role. */
  closedDates: ReadonlySet<string>;
  onOpenDay: (date: string) => void;
}) {
  const grid = monthGrid(date);
  const today = todayInZone();
  const counts = countByDay(items);

  return (
    <section aria-label="Ay görünümü" className="inset-group overflow-hidden">
      <div aria-hidden="true" className="grid grid-cols-7 border-b border-separator bg-surface">
        {weekdayHeaders.map((day) => (
          <span key={day} className="py-2 text-center text-footnote font-medium text-ink-muted">
            {day}
          </span>
        ))}
      </div>
      <ul className="grid grid-cols-7">
        {grid.weeks.flat().map((day) => {
          const inMonth = day.startsWith(grid.month);
          const isToday = day === today;
          const closed = closedDates.has(day);
          const entry = counts.get(day);
          const total = entry?.total ?? 0;
          const statuses = statusOrder.filter((status) => entry?.byStatus.get(status));
          const breakdown = statuses
            .map((status) => `${entry?.byStatus.get(status)} ${(appointmentStatusLabels[status] ?? status).toLocaleLowerCase("tr-TR")}`)
            .join(", ");
          const label = [
            formatLongDate(day),
            isToday ? "bugün" : null,
            closed ? "kapalı gün" : null,
            total ? `${total} randevu: ${breakdown}` : "randevu yok",
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={day} className="border-b border-r border-separator [&:nth-child(7n)]:border-r-0">
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={`${label}. Gün görünümünü aç`}
                aria-current={isToday ? "date" : undefined}
                className={`focus-ring flex h-full min-h-[4.25rem] w-full flex-col items-start gap-1 p-1.5 text-left transition-colors duration-150 hover:bg-surface-muted motion-reduce:transition-none sm:min-h-24 sm:p-2 ${
                  closed ? "bg-status-rejected-bg/60" : inMonth ? "bg-surface" : "bg-surface-muted"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-subhead tabular-nums ${
                    isToday ? "bg-action font-semibold text-on-action" : inMonth ? "font-medium text-ink" : "text-ink-muted"
                  }`}
                >
                  {Number(day.slice(8, 10))}
                </span>
                {closed && (
                  <span aria-hidden="true" className="text-caption font-semibold text-status-rejected">
                    Kapalı
                  </span>
                )}
                {total > 0 && (
                  <span aria-hidden="true" className="mt-auto flex w-full flex-wrap items-center gap-1">
                    <span className="text-caption font-semibold tabular-nums text-ink">
                      {total}
                      <span className="hidden sm:inline"> randevu</span>
                    </span>
                    <span className="flex gap-0.5">
                      {statuses.map((status) => (
                        <span key={status} className={`h-1.5 w-1.5 rounded-full ${appointmentStatusDot[status] ?? "bg-ink-muted"}`} />
                      ))}
                    </span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

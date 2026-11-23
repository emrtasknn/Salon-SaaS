"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { haptic } from "@/lib/haptics";
import { formatIsoDayLabel } from "./date-format";
import { appointmentStatusBadge, appointmentStatusLabel, badgeBase } from "./styles";
import { dateInZone, TIMELINE_TIME_ZONE, todayInZone } from "./timeline-layout";

// Agenda rows for the Month (selected day) and List (whole loaded week) views. Tapping a row
// opens the same appointment sheet as the timeline, where all actions live. Presentation only.

export type AgendaItem = Readonly<{
  id: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
  customer: string;
  service: string;
  /** Admin only: whose appointment it is. */
  staffName?: string;
}>;

export type AgendaFilter = "all" | "pending";

const time = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TIMELINE_TIME_ZONE });
const ms = (value: Date | string) => new Date(value).getTime();

/** Items grouped by local date, days and rows in time order; `filter` keeps only pending ones. */
export function groupAgenda<T extends AgendaItem>(items: readonly T[], filter: AgendaFilter = "all") {
  const groups = new Map<string, T[]>();
  const sorted = [...items].filter((item) => filter === "all" || item.status === "PENDING").sort((a, b) => ms(a.startAt) - ms(b.startAt));
  for (const item of sorted) {
    const day = dateInZone(item.startAt);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups.entries()].map(([date, rows]) => ({ date, rows }));
}

function AgendaRow({ item, onSelect }: { item: AgendaItem; onSelect: (id: string, trigger: HTMLElement) => void }) {
  const ended = item.status === "CANCELLED" || item.status === "REJECTED";
  return (
    <li className="inset-row">
      <button
        type="button"
        onClick={(event) => {
          haptic("selection");
          onSelect(item.id, event.currentTarget);
        }}
        className={`focus-ring tap-target flex w-full items-center gap-3 px-4 py-3 text-left text-body [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted ${ended ? "text-ink-muted" : "text-ink"}`}
      >
        <span className="w-12 shrink-0 tabular-nums">
          <span className="block text-headline">{time.format(new Date(item.startAt))}</span>
          <span className="block text-caption text-ink-muted">{time.format(new Date(item.endAt))}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${ended ? "line-through" : ""}`}>{item.customer}</span>
          <span className="block truncate text-footnote text-ink-muted">
            {item.service}
            {item.staffName ? ` · ${item.staffName}` : ""}
          </span>
        </span>
        {item.status !== "CONFIRMED" ? (
          <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge[item.status] ?? "bg-surface-muted text-ink"}`}>
            {appointmentStatusLabel[item.status] ?? item.status}
          </span>
        ) : null}
        <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
      </button>
    </li>
  );
}

/** The selected day's appointments under the month grid. */
export function DayAgenda({
  date,
  items,
  onSelect,
  onOpenDay,
  emptyText = "Bu gün için randevu yok.",
}: {
  date: string;
  items: readonly AgendaItem[];
  onSelect: (id: string, trigger: HTMLElement) => void;
  onOpenDay: (date: string) => void;
  emptyText?: string;
}) {
  const rows = groupAgenda(items.filter((item) => dateInZone(item.startAt) === date))[0]?.rows ?? [];
  return (
    <section aria-labelledby="day-agenda-title" className="mt-4">
      <div className="flex items-end justify-between gap-2">
        <h2 id="day-agenda-title" className="group-label">{formatIsoDayLabel(date, todayInZone())}</h2>
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          className="focus-ring mb-1.5 rounded px-2 text-subhead font-semibold text-ink hover:underline"
        >
          Gün görünümü
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="inset-group p-6 text-center text-body text-ink-muted">{emptyText}</div>
      ) : (
        <ul className="inset-group">
          {rows.map((item) => (
            <AgendaRow key={item.id} item={item} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * List view: every loaded day (the anchor's week) as a group with a sticky day label, with a
 * Tümü / Bekleyen filter. The selected day is scrolled into view when it changes.
 */
export function WeekAgenda({
  date,
  items,
  onSelect,
}: {
  date: string;
  items: readonly AgendaItem[];
  onSelect: (id: string, trigger: HTMLElement) => void;
}) {
  const [filter, setFilter] = useState<AgendaFilter>("all");
  const groups = groupAgenda(items, filter);
  const pendingCount = items.filter((item) => item.status === "PENDING").length;
  const today = todayInZone();
  const root = useRef<HTMLDivElement>(null);

  // Picking another day in the week strip scrolls to its group; the first paint stays at the top.
  const shownDate = useRef(date);
  useEffect(() => {
    if (shownDate.current === date) return;
    shownDate.current = date;
    root.current?.querySelector<HTMLElement>(`[data-agenda-day="${date}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [date]);

  const chip = (active: boolean) =>
    `pressable focus-ring inline-flex min-h-9 items-center rounded-full border px-3.5 text-subhead font-semibold ${
      active ? "border-action bg-action text-on-action" : "border-separator bg-surface text-ink hover:bg-surface-muted"
    }`;

  return (
    <div ref={root}>
      <div role="group" aria-label="Filtre" className="mb-3 flex gap-2">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} className={chip(filter === "all")}>
          Tümü
        </button>
        <button type="button" aria-pressed={filter === "pending"} onClick={() => setFilter("pending")} className={chip(filter === "pending")}>
          Bekleyen{pendingCount > 0 ? ` · ${pendingCount}` : ""}
        </button>
      </div>
      {groups.length === 0 ? (
        <div className="inset-group p-8 text-center text-body text-ink-muted">
          {filter === "pending" ? "Bu hafta onay bekleyen talep yok." : "Bu hafta randevu yok."}
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.date} data-agenda-day={group.date} aria-labelledby={`agenda-${group.date}`} className="scroll-mt-48">
              <h2
                id={`agenda-${group.date}`}
                className={`group-label ${group.date === date ? "text-ink" : ""}`}
              >
                {formatIsoDayLabel(group.date, today)}
                <span className="font-normal text-ink-muted"> · {group.rows.length}</span>
              </h2>
              <ul className="inset-group">
                {group.rows.map((item) => (
                  <AgendaRow key={item.id} item={item} onSelect={onSelect} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

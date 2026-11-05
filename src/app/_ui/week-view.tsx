"use client";

// Week view: seven day columns (Mon–Sun), hours on Y. In the admin calendar bars are colored per
// staff member with filter chips; the staff calendar shows only the signed-in member's own
// appointments (the loader already restricts them). Presentation only.

import { useMemo, useState } from "react";
import { staffPalette } from "./styles";
import { formatLongDate, TimeGrid, type GridColumn, type GridItem } from "./day-timeline";
import { dateInZone, todayInZone, weekDates } from "./timeline-layout";

export type WeekItem = Readonly<{
  id: string;
  staffId: string;
  staffName: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
  customer: string;
  service: string;
}>;

const weekdayShort = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

/** Staff present in the data, sorted by name, each with a stable palette slot for this list. */
export function staffLegend(items: ReadonlyArray<Pick<WeekItem, "staffId" | "staffName">>) {
  const names = new Map<string, string>();
  for (const item of items) names.set(item.staffId, item.staffName);
  return [...names]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr-TR") || a.id.localeCompare(b.id))
    .map((staff, index) => ({ ...staff, palette: staffPalette[index % staffPalette.length] }));
}

const chipClass =
  "pressable focus-ring tap-target inline-flex items-center gap-2 rounded-full border px-3.5 text-subhead font-medium";

export function WeekView({
  date,
  items,
  perStaffColors,
  onSelect,
  onOpenDay,
}: {
  date: string;
  items: ReadonlyArray<WeekItem>;
  /** Admin: color bars per staff and show the staff filter chips. */
  perStaffColors: boolean;
  onSelect: (id: string, trigger: HTMLElement) => void;
  onOpenDay: (date: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const days = weekDates(date);
  const today = todayInZone();
  const legend = useMemo(() => staffLegend(items), [items]);
  const activeFilter = legend.some((staff) => staff.id === filter) ? filter : "all";

  const columns: GridColumn[] = days.map((day, index) => ({
    id: day,
    date: day,
    label: weekdayShort[index],
    sublabel: String(Number(day.slice(8, 10))),
    highlight: day === today,
    onHeaderClick: () => onOpenDay(day),
    headerAriaLabel: `${formatLongDate(day)}${day === today ? ", bugün" : ""}. Gün görünümünü aç`,
  }));

  const gridItems: GridItem[] = items
    .filter((item) => activeFilter === "all" || item.staffId === activeFilter)
    .map((item) => {
      const palette = legend.find((staff) => staff.id === item.staffId)?.palette;
      return {
        id: item.id,
        columnId: dateInZone(item.startAt),
        startAt: item.startAt,
        endAt: item.endAt,
        status: item.status,
        title: item.customer,
        detail: perStaffColors ? `${item.staffName} · ${item.service}` : item.service,
        colorClass: perStaffColors ? palette?.bar : undefined,
      };
    })
    .filter((item) => days.includes(item.columnId));

  return (
    <div className="space-y-3">
      {perStaffColors && legend.length > 1 && (
        <div role="group" aria-label="Personel filtresi" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            aria-pressed={activeFilter === "all"}
            onClick={() => setFilter("all")}
            className={`${chipClass} shrink-0 ${activeFilter === "all" ? "border-action bg-action text-on-action" : "border-separator bg-surface text-ink hover:bg-surface-muted"}`}
          >
            Tümü
          </button>
          {legend.map((staff) => {
            const selected = activeFilter === staff.id;
            return (
              <button
                key={staff.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(staff.id)}
                className={`${chipClass} shrink-0 ${selected ? "border-action bg-action text-on-action" : "border-separator bg-surface text-ink hover:bg-surface-muted"}`}
              >
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${staff.palette.dot}`} />
                {staff.name}
              </button>
            );
          })}
        </div>
      )}
      {gridItems.length === 0 && (
        <p className="text-subhead text-ink-muted">Bu hafta için randevu yok.</p>
      )}
      <TimeGrid caption="Hafta görünümü" columns={columns} items={gridItems} onSelect={onSelect} minColumnRem={6.5} />
    </div>
  );
}

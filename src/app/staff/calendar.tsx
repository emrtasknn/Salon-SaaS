"use client";

import { useRef, useState, useTransition } from "react";
import { createStaffAppointment, getStaffCreateOptions, listStaffAppointments, listStaffSlots } from "./actions";
import { CreateAppointmentDialog } from "../create-appointment-dialog";
import { AppBar } from "../_ui/app-bar";
import { AccountLinks } from "../_ui/account-links";
import { appointmentStatusBadge, badgeBase, buttonDestructiveOutline, buttonPrimary, buttonSecondary, fieldInline, statusNote } from "../_ui/styles";
import { AppointmentSheet, DateStepper, DayTimeline, DetailList, formatPeriod, formatTimeRange, useCalendarData, useCalendarView, ViewSwitch } from "../_ui/day-timeline";
import { WeekView } from "../_ui/week-view";
import { MonthView } from "../_ui/month-view";
import { dateInZone } from "../_ui/timeline-layout";

// Staff create for themselves only (staffId derived server-side), guest customer only.
const createVariant = { kind: "staff", loadOptions: getStaffCreateOptions, listSlots: listStaffSlots, create: createStaffAppointment } as const;
import { decideAndNotify } from "./decide";
import { BookingContactSummary } from "../booking-contact-summary";

type Props = { initialDate: string; initialData: Awaited<ReturnType<typeof listStaffAppointments>> };

const labels: Record<string, string> = {
  PENDING: "Bekliyor", CONFIRMED: "Onaylandı", REJECTED: "Reddedildi",
  CANCELLED: "İptal", COMPLETED: "Tamamlandı",
};

/** The staff view is always the signed-in staff member's own day: a single column. */
const SELF_COLUMN = [{ id: "self", label: "Randevularım" }] as const;
const NO_CLOSURES: ReadonlySet<string> = new Set();

export function StaffCalendar({ initialDate, initialData }: Props) {
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useCalendarView();
  // Own appointments only: the loader derives the staff member from the session.
  const { data, stale, busy: loading, refresh } = useCalendarData(listStaffAppointments, view, date, { startDate: initialDate, endDate: initialDate, data: initialData });
  const [acting, startTransition] = useTransition();
  const busy = loading || acting;
  const [feedback, setFeedback] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sheetTrigger = useRef<HTMLElement | null>(null);

  function changeDate(nextDate: string) {
    setSelectedId(null);
    setFeedback("");
    setDate(nextDate);
  }

  function openDay(nextDate: string) {
    changeDate(nextDate);
    setView("day");
  }

  function onCreated(created: { date: string; notified: boolean }) {
    setDate(created.date);
    refresh();
    setFeedback(created.notified ? "Randevu oluşturuldu ve onaylandı. Müşteri bildirimi gönderime alındı." : "Randevu oluşturuldu ve onaylandı.");
  }

  function decide(appointmentId: string, to: "CONFIRMED" | "REJECTED") {
    startTransition(async () => {
      const result = await decideAndNotify(appointmentId, to);
      if (result.status === "updated") {
        setFeedback(to === "CONFIRMED" ? "Randevu onaylandı." : "Randevu reddedildi.");
        refresh();
      } else if (result.status === "INVALID_TRANSITION") {
        setFeedback("Bu randevu için karar artık geçerli değil. Liste yenilendi.");
        refresh();
      } else if (result.status === "NOT_FOUND") {
        setFeedback("Randevu bulunamadı. Liste yenilendi.");
        refresh();
      } else if (result.status === "UNAUTHORIZED") {
        setFeedback("Bu randevu için yetkiniz yok.");
      } else {
        setFeedback("İşlem gerçekleştirilemedi.");
      }
    });
  }

  if (data.status === "UNAUTHORIZED") return <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6"><h1 className="text-title">Yetkisiz erişim</h1></main>;
  const appointments = data.status === "ok" ? data.appointments : [];
  const loadError = data.status !== "ok" ? "Randevular yüklenemedi." : "";
  // Day and list show only the anchor date (data may still hold a wider range while reloading).
  const dayAppointments = appointments.filter((a) => dateInZone(a.startAt) === date);
  const select = (id: string, trigger: HTMLElement) => { sheetTrigger.current = trigger; setSelectedId(id); };
  const selected = selectedId ? appointments.find((a) => a.id === selectedId) ?? null : null;
  const customerOf = (a: (typeof appointments)[number]) => a.bookingContact?.displayName ?? a.customerName;

  return <main className="min-h-screen bg-canvas">
    <header className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-6 sm:px-6">
      <div>
        <p className="text-footnote font-semibold text-ink-muted">Salon-SaaS</p>
        <h1 className="mt-1 text-large-title">Personel randevularım</h1>
        <p className="mt-1 text-subhead text-ink-muted" aria-live="polite">{formatPeriod(view, date)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Kept out of the sticky bar so the bar stays one row on phones. */}
        <CreateAppointmentDialog variant={createVariant} initialDate={date} onCreated={onCreated} />
        <AccountLinks />
      </div>
    </header>
    <AppBar widthClassName="max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <DateStepper date={date} view={view} onChange={changeDate} disabled={busy}>
          <input aria-label="Tarih" type="date" value={date} onChange={(e) => { if (e.target.value) changeDate(e.target.value); }} className={`${fieldInline} tabular-nums`} />
        </DateStepper>
        <button type="button" onClick={() => refresh()} disabled={busy} className={buttonSecondary}>{loading ? "Yükleniyor…" : "Yenile"}</button>
      </div>
      <ViewSwitch view={view} onChange={(next) => { setSelectedId(null); setView(next); }} />
    </AppBar>
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-4 sm:px-6">
      {(feedback || loadError) && <p role="status" className={`${statusNote} mb-4`}>{feedback || loadError}</p>}
      <div aria-busy={stale} className={stale ? "opacity-60 transition-opacity duration-150" : undefined}>
      {view === "month" ? <MonthView date={date} items={appointments} closedDates={NO_CLOSURES} onOpenDay={openDay} /> :
        view === "week" ? <WeekView
          date={date}
          perStaffColors={false}
          items={appointments.map((a) => ({ id: a.id, staffId: "self", staffName: "", startAt: a.startAt, endAt: a.endAt, status: a.status, customer: customerOf(a), service: a.serviceName }))}
          onSelect={select}
          onOpenDay={openDay}
        /> :
        dayAppointments.length === 0 ? <div className="inset-group p-8 text-center text-body text-ink-muted">Bu gün için randevu yok.</div> :
        view === "day" ? <DayTimeline
          date={date}
          rows={SELF_COLUMN}
          items={dayAppointments.map((a) => ({ id: a.id, rowId: "self", startAt: a.startAt, endAt: a.endAt, status: a.status, customer: customerOf(a), service: a.serviceName }))}
          onSelect={select}
        /> :
        <ul className="inset-group">{dayAppointments.map((a) => <li key={a.id} className="inset-row"><article className="px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-headline tabular-nums">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.startAt))}<span className="font-normal text-ink-muted">–{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.endAt))}</span></p>
              <p className="mt-1 break-words text-body">{customerOf(a)}</p>
              <p className="break-words text-footnote text-ink-muted">{a.serviceName}</p>
              <BookingContactSummary contact={a.bookingContact} profile={{ displayName: customerOf(a) }} />
            </div>
            <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge[a.status] ?? "bg-surface-muted text-ink"}`}>{labels[a.status] ?? a.status}</span>
          </div>
          {a.status === "PENDING" && <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => decide(a.id, "CONFIRMED")} className={`${buttonPrimary} flex-1 sm:flex-none`}>Onayla</button>
            <button disabled={busy} onClick={() => decide(a.id, "REJECTED")} className={`${buttonDestructiveOutline} flex-1 sm:flex-none`}>Reddet</button>
          </div>}
        </article></li>)}</ul>}
      </div>
    </div>

    <AppointmentSheet
      open={selected !== null}
      title={selected ? formatTimeRange(selected.startAt, selected.endAt) : ""}
      onClose={() => { setSelectedId(null); sheetTrigger.current?.focus(); }}
    >
      {selected && <div className="space-y-4">
        <span className={`${badgeBase} ${appointmentStatusBadge[selected.status] ?? "bg-surface-muted text-ink"}`}>{labels[selected.status] ?? selected.status}</span>
        <DetailList entries={[
          { label: "Müşteri", value: customerOf(selected) },
          { label: "Hizmet", value: selected.serviceName },
        ]} />
        <BookingContactSummary contact={selected.bookingContact} profile={{ displayName: customerOf(selected) }} />
        {feedback && <p role="status" className="text-subhead text-ink">{feedback}</p>}
        {selected.status === "PENDING" ? <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={busy} onClick={() => decide(selected.id, "CONFIRMED")} className={`${buttonPrimary} sm:flex-1`}>Onayla</button>
          <button type="button" disabled={busy} onClick={() => decide(selected.id, "REJECTED")} className={`${buttonDestructiveOutline} sm:flex-1`}>Reddet</button>
        </div> : <p className="text-subhead text-ink-muted">Bu randevu için başka işlem yok.</p>}
      </div>}
    </AppointmentSheet>
  </main>;
}

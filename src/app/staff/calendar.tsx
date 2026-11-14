"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { completeStaffAppointment, createStaffAppointment, getStaffCreateOptions, listStaffAppointments, listStaffSlots, rescheduleStaffAppointment } from "./actions";
import { MoveStepButtons, useAppointmentMove } from "../_ui/appointment-move";
import { CreateAppointmentDialog } from "../create-appointment-dialog";
import { PageHeader } from "../_ui/page-header";
import { AccountRows } from "../_ui/account-links";
import { appointmentStatusBadge, badgeBase, statusNote, appointmentStatusLabel } from "../_ui/styles";
import { DateField } from "../_ui/date-field";
import { useMinuteClock, AppointmentSheet, DateStepper, DayTimeline, DetailList, formatPeriod, formatTimeRange, useCalendarData, useCalendarView, ViewSwitch } from "../_ui/day-timeline";
import { WeekView } from "../_ui/week-view";
import { MonthView } from "../_ui/month-view";
import { dateInZone } from "../_ui/timeline-layout";
import { formatDayLabel } from "../_ui/date-format";
import { ConfirmButton } from "../_ui/confirm-button";
import { Button } from "@/components/ui/button";

// Staff create for themselves only (staffId derived server-side), guest customer only.
const createVariant = { kind: "staff", loadOptions: getStaffCreateOptions, listSlots: listStaffSlots, create: createStaffAppointment } as const;
import { decideAndNotify } from "./decide";
import { BookingContactSummary } from "../booking-contact-summary";
import { haptic } from "@/lib/haptics";
import { RotateCw } from "lucide-react";

type Props = {
  initialDate: string;
  initialData: Awaited<ReturnType<typeof listStaffAppointments>>;
  /** Fixed top layer content (greeting + bell), composed by the server page. */
  eyebrow?: ReactNode;
  title?: ReactNode;
  bell?: ReactNode;
  /** Push opt-in prompt, shown at the top of the content. */
  pushPrompt?: ReactNode;
  /** Appointment to open on load (deep link from a notification); UI selection only. */
  initialSelectedId?: string | null;
};

/** The staff view is always the signed-in staff member's own day: a single column. */
const SELF_COLUMN = [{ id: "self", label: "Randevularım" }] as const;
const NO_CLOSURES: ReadonlySet<string> = new Set();

export function StaffCalendar({ initialDate, initialData, eyebrow, title = "Randevularım", bell, pushPrompt, initialSelectedId = null }: Props) {
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useCalendarView();
  // Own appointments only: the loader derives the staff member from the session.
  const { data, stale, busy: loading, refresh } = useCalendarData(listStaffAppointments, view, date, { startDate: initialDate, endDate: initialDate, data: initialData });
  const [acting, startTransition] = useTransition();
  const busy = loading || acting;
  const [feedback, setFeedback] = useState("");
  const nowMs = useMinuteClock();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const sheetTrigger = useRef<HTMLElement | null>(null);
  const move = useAppointmentMove({
    reschedule: rescheduleStaffAppointment,
    onDone: (message) => { setFeedback(message); refresh(); },
  });

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

  function complete(appointmentId: string) {
    haptic("selection");
    startTransition(async () => {
      const result = await completeStaffAppointment(appointmentId);
      haptic(result.status === "updated" ? "success" : "error");
      const messages: Record<string, string> = {
        updated: "Randevu tamamlandı.",
        NOT_STARTED: "Randevu başlamadan tamamlandı olarak işaretlenemez.",
        UNAUTHORIZED: "Bu randevu için yetkiniz yok.",
        NOT_FOUND: "Randevu bulunamadı. Liste yenilendi.",
        INVALID_TRANSITION: "Bu randevu artık tamamlanamaz. Liste yenilendi.",
      };
      setFeedback(messages[result.status] ?? "İşlem gerçekleştirilemedi.");
      if (result.status !== "UNAUTHORIZED") refresh();
    });
  }

  function decide(appointmentId: string, to: "CONFIRMED" | "REJECTED") {
    haptic(to === "REJECTED" ? "warning" : "selection");
    startTransition(async () => {
      const result = await decideAndNotify(appointmentId, to);
      haptic(result.status === "updated" ? (to === "CONFIRMED" ? "success" : "light") : "error");
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
  const select = (id: string, trigger: HTMLElement) => { sheetTrigger.current = trigger; setFeedback(""); setSelectedId(id); };
  const selected = selectedId ? appointments.find((a) => a.id === selectedId) ?? null : null;
  const customerOf = (a: (typeof appointments)[number]) => a.bookingContact?.displayName ?? a.customerName;
  const movableOf = (a: (typeof appointments)[number]) => ({ id: a.id, startAt: a.startAt, endAt: a.endAt, title: customerOf(a), detail: a.serviceName });

  return <main className="min-h-screen bg-canvas">
    <PageHeader eyebrow={eyebrow ?? "RandevuN"} title={title} accessory={bell} widthClassName="max-w-5xl">
      <ViewSwitch view={view} onChange={(next) => { setSelectedId(null); setView(next); }} />
      <DateStepper date={date} view={view} onChange={changeDate} disabled={busy}>
        <DateField value={date} onChange={changeDate} disabled={busy} />
      </DateStepper>
    </PageHeader>
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-4 sm:px-6">
      {pushPrompt ? <div className="mb-4">{pushPrompt}</div> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-subhead font-semibold text-ink-muted" aria-live="polite">{formatPeriod(view, date)}</p>
        <CreateAppointmentDialog variant={createVariant} initialDate={date} onCreated={onCreated} />
        <Button type="button" onClick={() => refresh()} disabled={busy} variant="secondary" leadingIcon={RotateCw} aria-label={loading ? "Yükleniyor" : "Yenile"} className="px-3 sm:px-4"><span className="sr-only sm:not-sr-only">{loading ? "Yükleniyor…" : "Yenile"}</span></Button>
      </div>
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
          items={dayAppointments.map((a) => move.preview({ id: a.id, rowId: "self", startAt: a.startAt, endAt: a.endAt, status: a.status, customer: customerOf(a), service: a.serviceName }))}
          onSelect={select}
          pendingId={move.pendingId}
          onMove={(id, deltaMinutes) => {
            const a = dayAppointments.find((candidate) => candidate.id === id);
            if (a) move.propose(movableOf(a), deltaMinutes);
          }}
        /> :
        <ul className="inset-group">{dayAppointments.map((a) => <li key={a.id} className="inset-row"><article className="px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-headline tabular-nums">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.startAt))}<span className="font-normal text-ink-muted">–{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.endAt))}</span></p>
              <p className="mt-1 break-words text-body">{customerOf(a)}</p>
              <p className="break-words text-footnote text-ink-muted">{a.serviceName}</p>
              <BookingContactSummary contact={a.bookingContact} profile={{ displayName: customerOf(a) }} />
            </div>
            <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge[a.status] ?? "bg-surface-muted text-ink"}`}>{appointmentStatusLabel[a.status] ?? a.status}</span>
          </div>
          {a.status === "PENDING" && <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} onClick={() => decide(a.id, "CONFIRMED")} variant="primary" className="flex-1 sm:flex-none">Onayla</Button>
            <Button type="submit" disabled={busy} onClick={() => decide(a.id, "REJECTED")} variant="danger-outline" className="flex-1 sm:flex-none">Reddet</Button>
          </div>}
        </article></li>)}</ul>}
      </div>
      <section aria-labelledby="staff-account-title" className="mt-10">
        <h2 id="staff-account-title" className="group-label">Hesap</h2>
        <AccountRows settingsHref="/staff/settings" />
      </section>
    </div>

    <AppointmentSheet
      open={selected !== null}
      title={selected ? `${formatDayLabel(selected.startAt)} · ${formatTimeRange(selected.startAt, selected.endAt)}` : ""}
      onClose={() => { setSelectedId(null); sheetTrigger.current?.focus(); }}
    >
      {selected && <div className="space-y-4">
        <span className={`${badgeBase} ${appointmentStatusBadge[selected.status] ?? "bg-surface-muted text-ink"}`}>{appointmentStatusLabel[selected.status] ?? selected.status}</span>
        <DetailList entries={[
          { label: "Müşteri", value: customerOf(selected) },
          { label: "Hizmet", value: selected.serviceName },
        ]} />
        <BookingContactSummary contact={selected.bookingContact} profile={{ displayName: customerOf(selected) }} />
        {feedback && <p role="status" className="text-subhead text-ink">{feedback}</p>}
        {(selected.status === "PENDING" || selected.status === "CONFIRMED") && <MoveStepButtons
          disabled={busy || move.saving}
          onStep={(deltaMinutes) => { const target = selected; setSelectedId(null); move.propose(movableOf(target), deltaMinutes); }}
        />}
        {selected.status === "PENDING" ? <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" disabled={busy} onClick={() => decide(selected.id, "CONFIRMED")} variant="primary" className="sm:flex-1">Onayla</Button>
          <ConfirmButton label="Reddet" question="Talep reddedilsin mi?" detail="Bu işlem geri alınamaz. Müşteri bildirim izni verdiyse bilgilendirilir." confirmLabel="Evet, reddet" disabled={busy} onConfirm={() => decide(selected.id, "REJECTED")} className="sm:flex-1" />
        </div> : selected.status === "CONFIRMED" && nowMs !== null && new Date(selected.startAt).getTime() <= nowMs ? <div className="flex flex-col gap-2">
          <Button type="button" disabled={busy} onClick={() => complete(selected.id)} variant="primary">Tamamlandı</Button>
          <p className="text-footnote text-ink-muted">İptal işlemini işletme yöneticisi yapar.</p>
        </div> : <p className="text-subhead text-ink-muted">{selected.status === "CONFIRMED" ? "Randevu başlayınca tamamlandı olarak işaretleyebilirsiniz. İptal işlemini işletme yöneticisi yapar." : "Bu randevu için başka işlem yok."}</p>}
      </div>}
    </AppointmentSheet>
    {move.sheet}
  </main>;
}

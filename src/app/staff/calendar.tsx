"use client";

import { useState, useTransition } from "react";
import { createStaffAppointment, getStaffCreateOptions, listStaffAppointments, listStaffSlots } from "./actions";
import { CreateAppointmentDialog } from "../create-appointment-dialog";
import { AppBar } from "../_ui/app-bar";
import { appointmentStatusBadge, badgeBase, buttonDestructiveOutline, buttonPrimary, buttonSecondary, fieldInline, statusNote } from "../_ui/styles";

// Staff create for themselves only (staffId derived server-side), guest customer only.
const createVariant = { kind: "staff", loadOptions: getStaffCreateOptions, listSlots: listStaffSlots, create: createStaffAppointment } as const;
import { decideAndNotify } from "./decide";
import { BookingContactSummary } from "../booking-contact-summary";

type Props = { initialDate: string; initialData: Awaited<ReturnType<typeof listStaffAppointments>> };

const labels: Record<string, string> = {
  PENDING: "Bekliyor", CONFIRMED: "Onaylandı", REJECTED: "Reddedildi",
  CANCELLED: "İptal", COMPLETED: "Tamamlandı",
};

export function StaffCalendar({ initialDate, initialData }: Props) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  function refresh(nextDate = date) {
    startTransition(async () => {
      const result = await listStaffAppointments(nextDate);
      setData(result);
      if (result.status !== "ok") setFeedback(result.status === "UNAUTHORIZED" ? "Bu alan için yetkiniz yok." : "Randevular yüklenemedi.");
    });
  }

  function onCreated(created: { date: string; notified: boolean }) {
    setDate(created.date);
    startTransition(async () => {
      setData(await listStaffAppointments(created.date));
      setFeedback(created.notified ? "Randevu oluşturuldu ve onaylandı. Müşteri bildirimi gönderime alındı." : "Randevu oluşturuldu ve onaylandı.");
    });
  }

  function decide(appointmentId: string, to: "CONFIRMED" | "REJECTED") {
    startTransition(async () => {
      const result = await decideAndNotify(appointmentId, to);
      if (result.status === "updated") {
        setFeedback(to === "CONFIRMED" ? "Randevu onaylandı." : "Randevu reddedildi.");
        setData(await listStaffAppointments(date));
      } else if (result.status === "INVALID_TRANSITION") {
        setFeedback("Bu randevu için karar artık geçerli değil. Liste yenilendi.");
        setData(await listStaffAppointments(date));
      } else if (result.status === "NOT_FOUND") {
        setFeedback("Randevu bulunamadı. Liste yenilendi.");
        setData(await listStaffAppointments(date));
      } else if (result.status === "UNAUTHORIZED") {
        setFeedback("Bu randevu için yetkiniz yok.");
      } else {
        setFeedback("İşlem gerçekleştirilemedi.");
      }
    });
  }

  if (data.status === "UNAUTHORIZED") return <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6"><h1 className="text-title">Yetkisiz erişim</h1></main>;
  const appointments = data.status === "ok" ? data.appointments : [];

  return <main className="min-h-screen bg-canvas">
    <header className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-6 sm:px-6">
      <div>
        <p className="text-footnote font-semibold text-ink-muted">Salon-SaaS</p>
        <h1 className="mt-1 text-large-title">Personel randevularım</h1>
      </div>
      {/* Kept out of the sticky bar so the bar stays one row on phones. */}
      <CreateAppointmentDialog variant={createVariant} initialDate={date} onCreated={onCreated} />
    </header>
    <AppBar widthClassName="max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Tarih" type="date" value={date} onChange={(e) => { setDate(e.target.value); refresh(e.target.value); }} className={`${fieldInline} tabular-nums`} />
        <button onClick={() => refresh()} disabled={busy} className={buttonSecondary}>{busy ? "Yükleniyor…" : "Yenile"}</button>
      </div>
    </AppBar>
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-4 sm:px-6">
      {feedback && <p role="status" className={`${statusNote} mb-4`}>{feedback}</p>}
      {appointments.length === 0 ? <div className="inset-group p-8 text-center text-body text-ink-muted">Bu gün için randevu yok.</div> :
        <ul className="inset-group">{appointments.map((a) => <li key={a.id} className="inset-row"><article className="px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-headline tabular-nums">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.startAt))}<span className="font-normal text-ink-muted">–{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.endAt))}</span></p>
              <p className="mt-1 break-words text-body">{a.bookingContact?.displayName ?? a.customerName}</p>
              <p className="break-words text-footnote text-ink-muted">{a.serviceName}</p>
              <BookingContactSummary contact={a.bookingContact} profile={{ displayName: a.bookingContact?.displayName ?? a.customerName }} />
            </div>
            <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge[a.status] ?? "bg-surface-muted text-ink"}`}>{labels[a.status] ?? a.status}</span>
          </div>
          {a.status === "PENDING" && <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => decide(a.id, "CONFIRMED")} className={`${buttonPrimary} flex-1 sm:flex-none`}>Onayla</button>
            <button disabled={busy} onClick={() => decide(a.id, "REJECTED")} className={`${buttonDestructiveOutline} flex-1 sm:flex-none`}>Reddet</button>
          </div>}
        </article></li>)}</ul>}
    </div>
  </main>;
}

"use client";

import { useState, useTransition } from "react";
import { listStaffAppointments } from "./actions";
import { decideAndNotify } from "./decide";
import { BookingContactSummary } from "../booking-contact-summary";
import { AppBar } from "../_ui/app-bar";
import { appointmentStatusBadge, badgeBase, buttonDestructiveOutline, buttonPrimary, buttonSecondary, fieldInline, statusNote } from "../_ui/styles";

type Props = { initialDate: string; initialData: Awaited<ReturnType<typeof listStaffAppointments>> };
const labels: Record<string, string> = { PENDING: "Bekliyor", CONFIRMED: "Onaylandı", REJECTED: "Reddedildi", CANCELLED: "İptal", COMPLETED: "Tamamlandı" };

export function StaffAppointments({ initialDate, initialData }: Props) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  function refresh(nextDate = date) {
    startTransition(async () => { const r = await listStaffAppointments(nextDate); setData(r); if (r.status !== "ok") setFeedback("Randevular yüklenemedi."); });
  }

  if (data.status === "UNAUTHORIZED") return <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6"><h1 className="text-title">Yetkisiz erişim</h1><p className="mt-2 text-body text-ink-muted">Bu alan aktif personel hesabına açıktır.</p></main>;
  const appointments = data.status === "ok" ? data.appointments : [];

  return <main className="min-h-screen bg-canvas">
    <header className="mx-auto max-w-4xl px-4 pb-3 pt-6 sm:px-6">
      <p className="text-footnote font-semibold text-ink-muted">Salon-SaaS</p>
      <h1 className="mt-1 text-large-title">Randevularım</h1>
    </header>
    <AppBar widthClassName="max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="Tarih" value={date} onChange={(e) => { setDate(e.target.value); refresh(e.target.value); }} className={`${fieldInline} tabular-nums`} />
        <button onClick={() => refresh()} disabled={busy} className={buttonSecondary}>{busy ? "Yükleniyor…" : "Yenile"}</button>
      </div>
    </AppBar>
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-4 sm:px-6">
      {feedback && <p role="status" className={`${statusNote} mb-4`}>{feedback}</p>}
      {appointments.length === 0 ? <div className="inset-group p-8 text-center text-body text-ink-muted">Bu gün için randevu yok.</div> :
        <ul className="inset-group">{appointments.map((a) => <li key={a.id} className="inset-row"><article className="px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p className="text-headline tabular-nums">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.startAt))}<span className="font-normal text-ink-muted">–{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.endAt))}</span></p>
              <p className="mt-1 break-words text-body">{a.bookingContact?.displayName ?? a.customerName}</p>
              <p className="break-words text-footnote text-ink-muted">{a.serviceName}</p>
              <BookingContactSummary contact={a.bookingContact} profile={{ displayName: a.bookingContact?.displayName ?? a.customerName }} />
            </div>
            <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge[a.status] ?? "bg-surface-muted text-ink"}`}>{labels[a.status] ?? a.status}</span>
          </div>
          {a.status === "PENDING" && <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={() => startTransition(async () => { const r = await decideAndNotify(a.id, "CONFIRMED"); setFeedback(r.status === "updated" ? "Randevu onaylandı." : "Randevu onaylanamadı."); if (r.status === "updated") refresh(); })} className={`${buttonPrimary} flex-1 sm:flex-none`}>Onayla</button><button disabled={busy} onClick={() => startTransition(async () => { const r = await decideAndNotify(a.id, "REJECTED"); setFeedback(r.status === "updated" ? "Randevu reddedildi." : "Randevu reddedilemedi."); if (r.status === "updated") refresh(); })} className={`${buttonDestructiveOutline} flex-1 sm:flex-none`}>Reddet</button></div>}
        </article></li>)}</ul>}
    </div>
  </main>;
}

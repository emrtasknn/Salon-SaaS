"use client";

import { useState, useTransition, type ReactNode } from "react";
import { completeStaffAppointment, listStaffAppointments } from "./actions";
import { decideAndNotify } from "./decide";
import { haptic } from "@/lib/haptics";
import { BookingContactSummary } from "../booking-contact-summary";
import { PageHeader } from "../_ui/page-header";
import { appointmentStatusBadge, badgeBase, fieldInline, statusNote, appointmentStatusLabel } from "../_ui/styles";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "../_ui/confirm-button";
import { TIMELINE_TIME_ZONE, todayInZone } from "../_ui/timeline-layout";
import { formatIsoDayLabel } from "../_ui/date-format";
import { useMinuteClock } from "../_ui/day-timeline";

const formatListDay = (dateIso: string) => formatIsoDayLabel(dateIso, todayInZone());

type Props = { initialDate: string; initialData: Awaited<ReturnType<typeof listStaffAppointments>>; bell?: ReactNode };
export function StaffAppointments({ initialDate, initialData, bell }: Props) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const nowMs = useMinuteClock();

  function refresh(nextDate = date) {
    startTransition(async () => { const r = await listStaffAppointments(nextDate); setData(r); if (r.status !== "ok") setFeedback("Randevular yüklenemedi."); });
  }

  if (data.status === "UNAUTHORIZED") return <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6"><h1 className="text-title">Yetkisiz erişim</h1><p className="mt-2 text-body text-ink-muted">Bu alan aktif personel hesabına açıktır.</p></main>;
  const appointments = data.status === "ok" ? data.appointments : [];

  return <main className="min-h-screen bg-canvas">
    <PageHeader eyebrow={formatListDay(date)} title="Randevularım" accessory={bell} widthClassName="max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="Tarih" value={date} onChange={(e) => { setDate(e.target.value); refresh(e.target.value); }} className={`${fieldInline} tabular-nums`} />
        <Button type="button" onClick={() => refresh()} disabled={busy} variant="secondary">{busy ? "Yükleniyor…" : "Yenile"}</Button>
      </div>
    </PageHeader>
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-4 sm:px-6">
      {feedback && <p role="status" className={`${statusNote} mb-4`}>{feedback}</p>}
      {appointments.length === 0 ? <div className="inset-group p-8 text-center text-body text-ink-muted">Bu gün için randevu yok.</div> :
        <ul className="inset-group">{appointments.map((a) => <li key={a.id} className="inset-row"><article className="px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p className="text-headline tabular-nums">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TIMELINE_TIME_ZONE }).format(new Date(a.startAt))}<span className="font-normal text-ink-muted">–{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TIMELINE_TIME_ZONE }).format(new Date(a.endAt))}</span></p>
              <p className="mt-1 break-words text-body">{a.bookingContact?.displayName ?? a.customerName}</p>
              <p className="break-words text-footnote text-ink-muted">{a.serviceName}</p>
              <BookingContactSummary contact={a.bookingContact} profile={{ displayName: a.bookingContact?.displayName ?? a.customerName }} />
            </div>
            <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge[a.status] ?? "bg-surface-muted text-ink"}`}>{appointmentStatusLabel[a.status] ?? a.status}</span>
          </div>
          {a.status === "PENDING" && <div className="mt-3 flex flex-wrap gap-2"><Button type="submit" disabled={busy} onClick={() => { haptic("selection"); startTransition(async () => { const r = await decideAndNotify(a.id, "CONFIRMED"); haptic(r.status === "updated" ? "success" : "error"); setFeedback(r.status === "updated" ? "Randevu onaylandı." : "Randevu onaylanamadı."); if (r.status === "updated") refresh(); }); }} variant="primary" className="flex-1 sm:flex-none">Onayla</Button><ConfirmButton label="Reddet" question="Talep reddedilsin mi?" detail="Bu işlem geri alınamaz. Müşteri bildirim izni verdiyse bilgilendirilir." confirmLabel="Evet, reddet" disabled={busy} className="flex-1 sm:flex-none" onConfirm={() => { startTransition(async () => { const r = await decideAndNotify(a.id, "REJECTED"); haptic(r.status === "updated" ? "light" : "error"); setFeedback(r.status === "updated" ? "Randevu reddedildi." : "Randevu reddedilemedi."); if (r.status === "updated") refresh(); }); }} /></div>}
          {a.status === "CONFIRMED" && nowMs !== null && new Date(a.startAt).getTime() <= nowMs && <div className="mt-3"><Button type="button" disabled={busy} variant="secondary" className="w-full sm:w-auto" onClick={() => { haptic("selection"); startTransition(async () => { const r = await completeStaffAppointment(a.id); haptic(r.status === "updated" ? "success" : "error"); setFeedback(r.status === "updated" ? "Randevu tamamlandı." : r.status === "NOT_STARTED" ? "Randevu başlamadan tamamlandı olarak işaretlenemez." : "Randevu tamamlanamadı."); if (r.status === "updated") refresh(); }); }}>Tamamlandı</Button></div>}
        </article></li>)}</ul>}
    </div>
  </main>;
}

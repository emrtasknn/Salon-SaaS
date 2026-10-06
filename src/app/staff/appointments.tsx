"use client";

import { useState, useTransition } from "react";
import { decideStaffAppointment, listStaffAppointments } from "./actions";

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

  if (data.status === "UNAUTHORIZED") return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-semibold">Yetkisiz erişim</h1><p className="mt-2 text-sm text-zinc-600">Bu alan aktif personel hesabına açıktır.</p></main>;
  const appointments = data.status === "ok" ? data.appointments : [];

  return <main className="min-h-screen bg-zinc-50"><div className="mx-auto max-w-4xl p-4 sm:p-6">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-zinc-500">Salon-SaaS</p><h1 className="text-3xl font-semibold tracking-tight">Randevularım</h1></div><div className="flex gap-2"><input type="date" aria-label="Tarih" value={date} onChange={(e) => { setDate(e.target.value); refresh(e.target.value); }} className="rounded-lg border bg-white px-3 py-2 text-sm" /><button onClick={() => refresh()} disabled={busy} className="rounded-lg border bg-white px-3 py-2 text-sm">{busy ? "Yükleniyor…" : "Yenile"}</button></div></header>
    {feedback && <p role="status" className="mb-4 rounded-lg border bg-white p-3 text-sm">{feedback}</p>}
    {appointments.length === 0 ? <div className="rounded-xl border bg-white p-8 text-center text-sm text-zinc-500">Bu gün için randevu yok.</div> :
      <div className="space-y-3">{appointments.map((a) => <article key={a.id} className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.startAt))}–{new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.endAt))}</p><p className="mt-1 text-xs text-zinc-500">Müşteri: {a.customerProfileId} · Hizmet: {a.serviceId}</p></div><span className="rounded-full border px-2 py-1 text-xs">{labels[a.status] ?? a.status}</span></div>
        {a.status === "PENDING" && <div className="mt-4 flex gap-2"><button disabled={busy} onClick={() => startTransition(async () => { const r = await decideStaffAppointment(a, "CONFIRMED"); setFeedback(r.status === "updated" ? "Randevu onaylandı." : "Randevu onaylanamadı."); if (r.status === "updated") refresh(); })} className="rounded-lg bg-black px-3 py-2 text-xs text-white">Onayla</button><button disabled={busy} onClick={() => startTransition(async () => { const r = await decideStaffAppointment(a, "REJECTED"); setFeedback(r.status === "updated" ? "Randevu reddedildi." : "Randevu reddedilemedi."); if (r.status === "updated") refresh(); })} className="rounded-lg border px-3 py-2 text-xs">Reddet</button></div>}
      </article>)}</div>}
  </div></main>;
}

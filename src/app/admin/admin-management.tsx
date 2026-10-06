"use client";

import { useState, useTransition } from "react";
import {
  createServiceAction,
  createStaffAction,
  listAdminData,
  removeWorkingHoursAction,
  saveWorkingHoursAction,
  setStaffStatusAction,
  toggleServiceAction,
} from "./actions";

type Props = { initialData: Awaited<ReturnType<typeof listAdminData>> };

const days = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

function message(status: string) {
  const map: Record<string, string> = {
    UNAUTHORIZED: "Bu işlem için yetkiniz yok.",
    INVALID_INPUT: "Bilgileri kontrol edin.",
    CONFLICT: "Bu kayıt mevcut veya çakışıyor.",
    PERSISTENCE_FAILURE: "Kayıt sırasında bir hata oluştu.",
    NOT_FOUND: "Kayıt bulunamadı.",
    AUTH_PROVISIONING_FAILED: "Personel hesabı oluşturulamadı.",
    COMPENSATION_FAILED: "Personel kaydı geri alınamadı. Destek gereklidir.",
  };
  return map[status] ?? "İşlem tamamlandı.";
}

export function AdminManagement({ initialData }: Props) {
  const [data, setData] = useState(initialData);
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  const refresh = () => startTransition(async () => {
    const next = await listAdminData();
    setData(next);
  });

  if (data.status === "UNAUTHORIZED") {
    return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-semibold">Yetkisiz erişim</h1><p className="mt-2 text-sm text-zinc-600">Bu alan yalnızca işletme yöneticilerine açıktır.</p></main>;
  }

  const services = data.services.status === "listed" ? data.services.services : [];
  const hours = data.workingHours.status === "listed" ? data.workingHours.workingHours : [];
  const staff = data.staff.status === "listed" ? data.staff.staff : [];

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">Salon-SaaS</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">İşletme yönetimi</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-600">Bugünün operasyonu için personel, hizmet ve çalışma saatlerini yönetin.</p>
          </div>
          <button className="rounded-lg border px-3 py-2 text-sm" onClick={refresh} disabled={busy}>{busy ? "Yenileniyor…" : "Yenile"}</button>
        </header>

        {feedback && <p role="status" className="mb-5 rounded-lg border bg-white p-3 text-sm">{feedback}</p>}

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">Personel</h2>
            <form className="mt-4 space-y-3" action={(formData) => startTransition(async () => {
              const result = await createStaffAction({
                displayName: String(formData.get("displayName") ?? ""),
                email: String(formData.get("email") ?? ""),
              });
              setFeedback(result.status === "created" ? "Personel oluşturuldu." : message(result.status));
              if (result.status === "created") refresh();
            })}>
              <input name="displayName" required placeholder="Ad soyad" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <input name="email" type="email" placeholder="E-posta" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <button disabled={busy} className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white">Personel ekle</button>
            </form>
            <div className="mt-5 space-y-2">
              {staff.length === 0 ? <p className="text-sm text-zinc-500">Henüz personel yok.</p> : staff.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span className="truncate font-mono text-xs">{item.id}</span>
                  <button className="text-xs underline" onClick={() => startTransition(async () => {
                    const result = await setStaffStatusAction(item.id, item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE");
                    setFeedback(message(result.status));
                    if (result.status === "updated") refresh();
                  })}>{item.status === "ACTIVE" ? "Pasifleştir" : "Aktifleştir"}</button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">Hizmetler</h2>
            <form className="mt-4 space-y-3" action={(formData) => startTransition(async () => {
              const result = await createServiceAction({
                name: String(formData.get("name") ?? ""),
                durationMinutes: Number(formData.get("durationMinutes") ?? 0),
                bufferMinutes: Number(formData.get("bufferMinutes") ?? 0),
              });
              setFeedback(message(result.status));
              if (result.status === "created") refresh();
            })}>
              <input name="name" required placeholder="Hizmet adı" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <input name="durationMinutes" required type="number" min="1" placeholder="Süre (dk)" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <input name="bufferMinutes" type="number" min="0" placeholder="Ara (dk)" className="w-full rounded-lg border px-3 py-2 text-sm" />
              <button disabled={busy} className="w-full rounded-lg bg-black px-3 py-2 text-sm font-medium text-white">Hizmet ekle</button>
            </form>
            <div className="mt-5 space-y-2">
              {services.length === 0 ? <p className="text-sm text-zinc-500">Henüz hizmet yok.</p> : services.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div><p className="font-medium">{item.name}</p><p className="text-xs text-zinc-500">{item.durationMinutes} dk · {item.bufferMinutes} dk ara</p></div>
                  <button className="text-xs underline" onClick={() => startTransition(async () => {
                    const result = await toggleServiceAction(item.id, !item.active);
                    setFeedback(message(result.status));
                    if (result.status === "updated") refresh();
                  })}>{item.active ? "Pasifleştir" : "Aktifleştir"}</button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border bg-white p-5">
            <h2 className="text-lg font-semibold">Çalışma saatleri</h2>
            <div className="mt-4 space-y-2">
              {days.map((day, index) => {
                const item = hours.find((value) => value.dayOfWeek === index);
                return <div key={day} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between"><span className="text-sm font-medium">{day}</span>{item && <button className="text-xs underline" onClick={() => startTransition(async () => { const result = await removeWorkingHoursAction(index); setFeedback(message(result.status)); if (result.status === "removed") refresh(); })}>Kaldır</button>}</div>
                  <form className="mt-2 flex gap-2" action={(formData) => startTransition(async () => {
                    const result = await saveWorkingHoursAction({ dayOfWeek: index, openMinute: Number(formData.get("openMinute") ?? 0), closeMinute: Number(formData.get("closeMinute") ?? 0) });
                    setFeedback(message(result.status));
                    if (result.status === "created" || result.status === "updated") refresh();
                  })}>
                    <input name="openMinute" type="number" min="0" max="1439" defaultValue={item?.openMinute ?? 540} className="w-full rounded border px-2 py-1 text-xs" aria-label={day + " açılış"} />
                    <input name="closeMinute" type="number" min="1" max="1440" defaultValue={item?.closeMinute ?? 1080} className="w-full rounded border px-2 py-1 text-xs" aria-label={day + " kapanış"} />
                    <button disabled={busy} className="rounded bg-zinc-900 px-2 py-1 text-xs text-white">Kaydet</button>
                  </form>
                </div>;
              })}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { getPublicAvailability } from "./actions";
import { submitBooking } from "./submit";

type ServiceOption = Readonly<{
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
}>;

type StaffOption = Readonly<{
  id: string;
  displayName: string;
}>;

type Slot = Readonly<{
  startAtIso: string;
  endAtIso: string;
}>;

function formatSlot(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function PublicBookingForm({
  slug,
  services,
  staff,
  timeZone,
  minDate,
  initialServiceId,
}: {
  slug: string;
  services: ReadonlyArray<ServiceOption>;
  staff: ReadonlyArray<StaffOption>;
  timeZone: string;
  minDate: string;
  initialServiceId: string;
}) {
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const [dateIso, setDateIso] = useState(minDate);
  const [slots, setSlots] = useState<ReadonlyArray<Slot>>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">(() =>
    initialServiceId && staff[0]?.id ? "loading" : "idle",
  );
  const [status, setStatus] = useState("");
  const [busy, startTransition] = useTransition();

  const selectedService = useMemo(() => services.find((service) => service.id === serviceId), [services, serviceId]);

  useEffect(() => {
    if (!serviceId || !staffId || !dateIso) {
      return;
    }

    let active = true;
    getPublicAvailability({ slug, serviceId, staffId, dateIso }).then((result) => {
      if (!active) return;
      if (result.status === "ok") {
        setSlots(result.slots);
        setAvailabilityStatus(result.slots.length ? "ready" : "empty");
      } else {
        setSlots([]);
        setAvailabilityStatus("error");
      }
    }).catch(() => {
      if (!active) return;
      setSlots([]);
      setAvailabilityStatus("error");
    });

    return () => {
      active = false;
    };
  }, [slug, serviceId, staffId, dateIso]);

  function submit(formData: FormData) {
    if (!selectedSlot) {
      setStatus("Lütfen uygun bir saat seçin.");
      return;
    }

    setStatus("");
    startTransition(async () => {
      const result = await submitBooking({
        slug,
        serviceId,
        staffId,
        startAtIso: selectedSlot,
        displayName: String(formData.get("displayName") ?? ""),
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
      });

      if (result.status === "created") {
        setStatus("Randevu talebiniz oluşturuldu.");
        setSelectedSlot("");
        setSlots((current) => current.filter((slot) => slot.startAtIso !== selectedSlot));
      } else if (result.status === "SLOT_UNAVAILABLE") {
        setStatus("Bu saat artık uygun değil. Lütfen başka bir saat seçin.");
        setSelectedSlot("");
        setAvailabilityStatus("loading");
        const refreshed = await getPublicAvailability({ slug, serviceId, staffId, dateIso });
        if (refreshed.status === "ok") {
          setSlots(refreshed.slots);
          setAvailabilityStatus(refreshed.slots.length ? "ready" : "empty");
        } else {
          setSlots([]);
          setAvailabilityStatus("error");
        }
      } else if (result.status === "INVALID_RESOURCE") {
        setStatus("Seçtiğiniz hizmet veya personel artık uygun değil.");
      } else if (result.status === "INVALID_INPUT") {
        setStatus("Bilgilerinizi kontrol edip tekrar deneyin.");
      } else {
        setStatus("Randevu oluşturulamadı. Lütfen daha sonra tekrar deneyin.");
      }
    });
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-xl p-4 sm:p-8">
        <form
          className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submit(new FormData(event.currentTarget));
          }}
        >
          <div>
            <h1 className="text-2xl font-semibold">Randevu talebi</h1>
            <p className="mt-1 text-sm text-zinc-600">Hizmetinizi, personelinizi ve uygun saati seçin.</p>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Hizmet</span>
            <select
              value={serviceId}
              onChange={(event) => {
                setServiceId(event.target.value);
                setSelectedSlot("");
                setAvailabilityStatus(event.target.value && staffId && dateIso ? "loading" : "idle");
              }}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">Hizmet seçin</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {service.durationMinutes + service.bufferMinutes} dk
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Personel</span>
            <select
              value={staffId}
              onChange={(event) => {
                setStaffId(event.target.value);
                setSelectedSlot("");
                setAvailabilityStatus(event.target.value && serviceId && dateIso ? "loading" : "idle");
              }}
              required
              disabled={!staff.length}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">Personel seçin</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Tarih</span>
            <input
              name="date"
              type="date"
              min={minDate}
              value={dateIso}
              onChange={(event) => {
                setDateIso(event.target.value);
                setSelectedSlot("");
                setAvailabilityStatus(event.target.value && serviceId && staffId ? "loading" : "idle");
              }}
              required
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>

          {selectedService && (
            <p className="text-xs text-zinc-500">
              Randevu süresi: {selectedService.durationMinutes} dk
              {selectedService.bufferMinutes ? ` + ${selectedService.bufferMinutes} dk hazırlık` : ""}
            </p>
          )}

          <section aria-live="polite" className="space-y-2">
            <div className="text-sm font-medium">Uygun saatler</div>
            {availabilityStatus === "loading" && <p className="text-sm text-zinc-500">Uygun saatler kontrol ediliyor…</p>}
            {availabilityStatus === "empty" && <p className="text-sm text-zinc-500">Bu tarih için uygun saat bulunmuyor.</p>}
            {availabilityStatus === "error" && <p className="text-sm text-zinc-500">Uygun saatler yüklenemedi. Lütfen tekrar deneyin.</p>}
            {availabilityStatus === "ready" && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => (
                  <button
                    key={slot.startAtIso}
                    type="button"
                    aria-pressed={selectedSlot === slot.startAtIso}
                    onClick={() => setSelectedSlot(slot.startAtIso)}
                    className={`rounded-lg border px-3 py-2 text-sm ${selectedSlot === slot.startAtIso ? "border-black bg-black text-white" : "bg-white hover:bg-zinc-50"}`}
                  >
                    {formatSlot(slot.startAtIso, timeZone)}
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="space-y-3 border-t pt-5">
            <div className="text-sm font-medium">İletişim bilgileri</div>
            <input name="displayName" required placeholder="Ad soyad" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input name="email" required type="email" placeholder="E-posta" className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input name="phone" placeholder="Telefon (opsiyonel)" className="w-full rounded-lg border px-3 py-2 text-sm" />
          </div>

          <button
            type="submit"
            disabled={busy || !selectedSlot || availabilityStatus !== "ready"}
            className="w-full rounded-lg bg-black px-4 py-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Gönderiliyor…" : "Randevu talebi gönder"}
          </button>

          {status && <p role="status" className="rounded-lg border p-3 text-sm">{status}</p>}
        </form>
      </div>
    </main>
  );
}

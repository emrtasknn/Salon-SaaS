"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { PublicLegalView } from "../../legal-consent-contract";
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

const fieldClassName =
  "w-full min-h-11 rounded-lg border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 aria-[invalid=true]:border-red-600";

// WP-10 failure codes. The server is authoritative; these are display strings only.
const legalErrors: Record<string, string> = {
  TENANT_LEGAL_INCOMPLETE: "Bu salon online randevu için henüz hazır değil. Lütfen salonla doğrudan iletişime geçin.",
  NOTICE_STALE: "Bilgilendirme metni güncellendi, lütfen sayfayı yenileyin.",
  OPT_IN_REQUIRES_PHONE: "WhatsApp bilgilendirmesi için telefon numaranızı girin veya kutunun işaretini kaldırın.",
  INVALID_PHONE: "Telefon numarası geçersiz. Ülke koduyla girin, örn. +905551234567.",
};

function formatSlot(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function PublicBookingForm({
  slug,
  legal,
  services,
  staff,
  timeZone,
  minDate,
  initialServiceId,
}: {
  slug: string;
  legal: PublicLegalView;
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
  const [availabilityStatus, setAvailabilityStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error" | "limited" | "inactive">(() =>
    initialServiceId && staff[0]?.id ? "loading" : "idle",
  );
  const [status, setStatus] = useState("");
  const [statusUrl, setStatusUrl] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [phone, setPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const [stale, setStale] = useState(false);
  const hasPhone = phone.trim() !== "";
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
        setAvailabilityStatus(result.status === "RATE_LIMITED" ? "limited" : result.status === "TENANT_INACTIVE" ? "inactive" : "error");
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

    const optedIn = whatsappOptIn && hasPhone;
    setStatus("");
    setPhoneError(false);
    setStatusUrl("");
    setCopyState("idle");
    startTransition(async () => {
      const result = await submitBooking({
        slug,
        serviceId,
        staffId,
        startAtIso: selectedSlot,
        displayName: String(formData.get("displayName") ?? ""),
        email: String(formData.get("email") ?? ""),
        phone: phone.trim(),
        noticeVersion: legal.noticeVersion,
        noticeHash: legal.noticeHash,
        whatsappOptIn: optedIn,
        optInVersion: optedIn ? legal.optInVersion : null,
        optInHash: optedIn ? legal.optInHash : null,
      });

      if (result.status === "created") {
        setStatus("Randevu talebiniz oluşturuldu.");
        if ("statusPath" in result && typeof result.statusPath === "string" && result.statusPath) {
          setStatusUrl(`${window.location.origin}${result.statusPath}`);
        }
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
          setAvailabilityStatus(refreshed.status === "RATE_LIMITED" ? "limited" : refreshed.status === "TENANT_INACTIVE" ? "inactive" : "error");
        }
      } else if (result.status === "INVALID_RESOURCE") {
        setStatus("Seçtiğiniz hizmet veya personel artık uygun değil.");
      } else if (result.status === "INVALID_INPUT") {
        setStatus("Bilgilerinizi kontrol edip tekrar deneyin.");
      } else if (result.status === "TENANT_INACTIVE") {
        setStatus("Şu anda online randevu alınmıyor.");
        setSelectedSlot("");
        setSlots([]);
        setAvailabilityStatus("inactive");
      } else if (result.status in legalErrors) {
        setStatus(legalErrors[result.status]);
        if (result.status === "INVALID_PHONE" || result.status === "OPT_IN_REQUIRES_PHONE") setPhoneError(true);
        if (result.status === "NOTICE_STALE") setStale(true);
        if (result.status === "TENANT_LEGAL_INCOMPLETE") {
          setSelectedSlot("");
          setSlots([]);
          setAvailabilityStatus("inactive");
        }
      } else if (result.status === "RATE_LIMITED") {
        setStatus("Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.");
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
            {availabilityStatus === "inactive" && <p className="text-sm text-zinc-500">Şu anda online randevu alınmıyor.</p>}
            {availabilityStatus === "limited" && <p className="text-sm text-zinc-500">Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.</p>}
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
            <h2 className="text-sm font-medium">İletişim bilgileri</h2>
            <div className="space-y-1">
              <label htmlFor="booking-name" className="text-sm">Ad soyad</label>
              <input id="booking-name" name="displayName" required autoComplete="name" className={fieldClassName} />
            </div>
            <div className="space-y-1">
              <label htmlFor="booking-email" className="text-sm">E-posta</label>
              <input id="booking-email" name="email" required type="email" autoComplete="email" className={fieldClassName} />
            </div>
            <div className="space-y-1">
              <label htmlFor="booking-phone" className="text-sm">Telefon (isteğe bağlı)</label>
              <input
                id="booking-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setPhoneError(false);
                  // Clearing the phone withdraws the (not yet submitted) opt-in.
                  if (event.target.value.trim() === "") setWhatsappOptIn(false);
                }}
                aria-invalid={phoneError}
                aria-describedby="booking-phone-help"
                className={fieldClassName}
              />
              <p id="booking-phone-help" className="text-xs text-zinc-600">Ülke koduyla girin, örn. +905551234567.</p>
            </div>

            <div className="space-y-1">
              <div className="flex items-start gap-3">
                <input
                  id="booking-whatsapp-optin"
                  type="checkbox"
                  checked={whatsappOptIn && hasPhone}
                  disabled={!hasPhone}
                  onChange={(event) => setWhatsappOptIn(event.target.checked)}
                  aria-describedby={hasPhone ? "booking-whatsapp-help" : "booking-whatsapp-help booking-whatsapp-disabled"}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-black focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
                />
                <label htmlFor="booking-whatsapp-optin" className={`text-sm ${hasPhone ? "text-zinc-900" : "text-zinc-500"}`}>
                  {legal.optInLabel}
                </label>
              </div>
              <p id="booking-whatsapp-help" className="pl-8 text-xs text-zinc-600">{legal.optInHelp}</p>
              {!hasPhone && (
                <p id="booking-whatsapp-disabled" className="pl-8 text-xs text-zinc-600">
                  Bu seçenek için önce telefon numaranızı girin.
                </p>
              )}
            </div>
          </div>

          <div id="booking-notice" className="space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
            <p className="whitespace-pre-line">{legal.shortNotice}</p>
            <a
              href={legal.fullNoticePath}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center font-medium text-zinc-900 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              Aydınlatma Metni
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          </div>

          <button
            type="submit"
            disabled={busy || stale || !selectedSlot || availabilityStatus !== "ready"}
            aria-describedby="booking-notice"
            className="min-h-11 w-full rounded-lg bg-black px-4 py-3 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Gönderiliyor…" : "Randevu talebi gönder"}
          </button>

          {status && <p role="status" className="rounded-lg border p-3 text-sm">{status}</p>}

          {stale && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-11 w-full rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              Sayfayı yenile
            </button>
          )}

          {statusUrl && (
            <section aria-labelledby="status-link-title" className="space-y-3 rounded-lg border bg-zinc-50 p-4">
              <h2 id="status-link-title" className="text-sm font-medium">Randevu bağlantınız</h2>
              <p className="text-sm text-zinc-600">
                Bu bağlantıyı kaydedin; randevunuzu görmek veya iptal etmek için kullanabilirsiniz.
              </p>
              <a href={statusUrl} className="block break-all rounded-lg border bg-white p-3 text-sm underline">
                {statusUrl}
              </a>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(statusUrl);
                    setCopyState("copied");
                  } catch {
                    setCopyState("failed");
                  }
                }}
                className="min-h-11 w-full rounded-lg border bg-white px-4 py-2 text-sm hover:bg-zinc-100 sm:w-auto"
              >
                Bağlantıyı kopyala
              </button>
              <p aria-live="polite" className="text-xs text-zinc-500">
                {copyState === "copied" && "Bağlantı kopyalandı."}
                {copyState === "failed" && "Kopyalanamadı. Bağlantıyı seçip elle kopyalayın."}
              </p>
            </section>
          )}
        </form>
      </div>
    </main>
  );
}

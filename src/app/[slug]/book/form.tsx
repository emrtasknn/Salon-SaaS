"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { PublicLegalView } from "../../legal-consent-contract";
import { getPublicAvailability } from "./actions";
import { submitBooking } from "./submit";
import { card, field, statusNote } from "../../_ui/styles";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { SalonLocationLink, type SalonLocationView } from "../../_ui/salon-location-link";
import { Button } from "@/components/ui/button";

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
  location = null,
  services,
  staff,
  timeZone,
  minDate,
  initialServiceId,
}: {
  slug: string;
  legal: PublicLegalView;
  /** Salon address + server-computed, allowlisted directions link; null when not set. */
  location?: SalonLocationView | null;
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
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-10 pt-4 sm:px-6">
        <Breadcrumb className="mb-3" items={[{ label: "Salon sayfası", href: `/${encodeURIComponent(slug)}` }, { label: "Randevu al" }]} />
        <form
          className="space-y-7"
          onSubmit={(event) => {
            event.preventDefault();
            submit(new FormData(event.currentTarget));
          }}
        >
          <header>
            <h1 className="text-large-title">Randevu talebi</h1>
            <p className="measure mt-2 text-body text-ink-muted">Hizmetinizi, personelinizi ve uygun saati seçin.</p>
            {location && <SalonLocationLink location={location} className="mt-1" />}
          </header>

          <div className={`${card} space-y-4`}>
            <label className="block space-y-1.5">
              <span className="text-subhead font-medium">Hizmet</span>
              <select
                value={serviceId}
                onChange={(event) => {
                  setServiceId(event.target.value);
                  setSelectedSlot("");
                  setAvailabilityStatus(event.target.value && staffId && dateIso ? "loading" : "idle");
                }}
                required
                className={field}
              >
                <option value="">Hizmet seçin</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {service.durationMinutes + service.bufferMinutes} dk
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-subhead font-medium">Personel</span>
              <select
                value={staffId}
                onChange={(event) => {
                  setStaffId(event.target.value);
                  setSelectedSlot("");
                  setAvailabilityStatus(event.target.value && serviceId && dateIso ? "loading" : "idle");
                }}
                required
                disabled={!staff.length}
                className={field}
              >
                <option value="">Personel seçin</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="text-subhead font-medium">Tarih</span>
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
                className={`${field} tabular-nums`}
              />
            </label>

            {selectedService && (
              <p className="text-footnote tabular-nums text-ink-muted">
                Randevu süresi: {selectedService.durationMinutes} dk
                {selectedService.bufferMinutes ? ` + ${selectedService.bufferMinutes} dk hazırlık` : ""}
              </p>
            )}
          </div>

          <section aria-live="polite" className={`${card} space-y-3`}>
            <div className="text-headline">Uygun saatler</div>
            {availabilityStatus === "loading" && <p className="text-subhead text-ink-muted">Uygun saatler kontrol ediliyor…</p>}
            {availabilityStatus === "empty" && <p className="text-subhead text-ink-muted">Bu tarih için uygun saat bulunmuyor.</p>}
            {availabilityStatus === "error" && <p className="text-subhead text-ink-muted">Uygun saatler yüklenemedi. Lütfen tekrar deneyin.</p>}
            {availabilityStatus === "inactive" && <p className="text-subhead text-ink-muted">Şu anda online randevu alınmıyor.</p>}
            {availabilityStatus === "limited" && <p className="text-subhead text-ink-muted">Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.</p>}
            {availabilityStatus === "ready" && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((slot) => (
                  <button
                    key={slot.startAtIso}
                    type="button"
                    aria-pressed={selectedSlot === slot.startAtIso}
                    onClick={() => setSelectedSlot(slot.startAtIso)}
                    className={`pressable focus-ring tap-target rounded-control border px-2 py-2.5 text-body font-medium tabular-nums ${selectedSlot === slot.startAtIso ? "border-action bg-action text-on-action" : "border-separator bg-surface-muted text-ink hover:border-field-border"}`}
                  >
                    {formatSlot(slot.startAtIso, timeZone)}
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className={`${card} space-y-4`}>
            <h2 className="text-headline">İletişim bilgileri</h2>
            <div className="space-y-1.5">
              <label htmlFor="booking-name" className="text-subhead font-medium">Ad soyad</label>
              <input id="booking-name" name="displayName" required autoComplete="name" className={field} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="booking-email" className="text-subhead font-medium">E-posta</label>
              <input id="booking-email" name="email" required type="email" autoComplete="email" className={field} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="booking-phone" className="text-subhead font-medium">Telefon (isteğe bağlı)</label>
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
                className={`${field} tabular-nums`}
              />
              <p id="booking-phone-help" className="text-footnote text-ink-muted">Ülke koduyla girin, örn. +905551234567.</p>
            </div>

            <div className="space-y-1 border-t border-separator pt-4">
              <div className="flex items-start gap-3">
                <input
                  id="booking-whatsapp-optin"
                  type="checkbox"
                  checked={whatsappOptIn && hasPhone}
                  disabled={!hasPhone}
                  onChange={(event) => setWhatsappOptIn(event.target.checked)}
                  aria-describedby={hasPhone ? "booking-whatsapp-help" : "booking-whatsapp-help booking-whatsapp-disabled"}
                  className="focus-ring mt-0.5 h-6 w-6 shrink-0 accent-action disabled:cursor-not-allowed"
                />
                <label htmlFor="booking-whatsapp-optin" className={`text-subhead ${hasPhone ? "text-ink" : "text-ink-muted"}`}>
                  {legal.optInLabel}
                </label>
              </div>
              <p id="booking-whatsapp-help" className="pl-9 text-footnote text-ink-muted">{legal.optInHelp}</p>
              {!hasPhone && (
                <p id="booking-whatsapp-disabled" className="pl-9 text-footnote text-ink-muted">
                  Bu seçenek için önce telefon numaranızı girin.
                </p>
              )}
            </div>
          </div>

          <div id="booking-notice" className="space-y-1 px-1 text-footnote text-ink-muted">
            <p className="whitespace-pre-line">{legal.shortNotice}</p>
            <a
              href={legal.fullNoticePath}
              target="_blank"
              rel="noopener"
              className="focus-ring inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2"
            >
              Aydınlatma Metni
              <span className="sr-only"> (yeni sekmede açılır)</span>
            </a>
          </div>

          <div className="space-y-3">
            <Button
              type="submit"
              disabled={busy || stale || !selectedSlot || availabilityStatus !== "ready"}
              aria-describedby="booking-notice"
              variant="primary" className="w-full"
            >
              {busy ? "Gönderiliyor…" : "Randevu talebi gönder"}
            </Button>

            {status && <p role="status" className={statusNote}>{status}</p>}

            {stale && (
              <Button
                type="button"
                onClick={() => window.location.reload()}
                variant="secondary" className="w-full"
              >
                Sayfayı yenile
              </Button>
            )}
          </div>

          {statusUrl && (
            <section aria-labelledby="status-link-title" className={`${card} space-y-3`}>
              <h2 id="status-link-title" className="text-headline">Randevu bağlantınız</h2>
              <p className="text-subhead text-ink-muted">
                Bu bağlantıyı kaydedin; randevunuzu görmek veya iptal etmek için kullanabilirsiniz.
              </p>
              <a href={statusUrl} className="focus-ring block break-all rounded-control bg-surface-muted p-3 text-subhead text-ink underline">
                {statusUrl}
              </a>
              <Button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(statusUrl);
                    setCopyState("copied");
                  } catch {
                    setCopyState("failed");
                  }
                }}
                variant="secondary" className="w-full sm:w-auto"
              >
                Bağlantıyı kopyala
              </Button>
              <p aria-live="polite" className="text-footnote text-ink-muted">
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

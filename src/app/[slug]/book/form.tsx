"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { PublicLegalView } from "../../legal-consent-contract";
import { getPublicAvailability } from "./actions";
import { submitBooking } from "./submit";
import { card, field, statusNote } from "../../_ui/styles";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { SalonLocationLink, type SalonLocationView } from "../../_ui/salon-location-link";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { formatServicePrice } from "../../../domain/service-price";
import { groupServicesByCategory } from "../../../domain/service-category";
import { BookingConfirmation, type BookingSummary } from "./booking-confirmation";
import {
  BOOKING_STEP_TITLES,
  dateStrip,
  formatDateLong,
  formatTime,
  groupSlots,
  initialStep,
  type BookingStep,
} from "./booking-steps";

type ServiceOption = Readonly<{
  id: string;
  name: string;
  durationMinutes: number;
  bufferMinutes: number;
  categoryId?: string | null;
  priceMinor?: number | null;
  priceIsFrom?: boolean;
}>;

type CategoryOption = Readonly<{ id: string; name: string; sortOrder: number }>;

type StaffOption = Readonly<{
  id: string;
  displayName: string;
}>;

type Slot = Readonly<{
  startAtIso: string;
  endAtIso: string;
}>;

type AvailabilityStatus = "idle" | "loading" | "ready" | "empty" | "error" | "limited" | "inactive";

// WP-10 failure codes. The server is authoritative; these are display strings only.
const legalErrors: Record<string, string> = {
  TENANT_LEGAL_INCOMPLETE: "Bu salon online randevu için henüz hazır değil. Lütfen salonla doğrudan iletişime geçin.",
  NOTICE_STALE: "Bilgilendirme metni güncellendi, lütfen sayfayı yenileyin.",
  OPT_IN_REQUIRES_PHONE: "WhatsApp bilgilendirmesi için telefon numaranızı girin veya kutunun işaretini kaldırın.",
  INVALID_PHONE: "Telefon numarası geçersiz. Ülke koduyla girin, örn. +905551234567.",
};

/** Preselect staff only when there is no real choice; otherwise the customer picks. */
export function initialStaffId(staff: ReadonlyArray<StaffOption>): string {
  return staff.length === 1 ? staff[0].id : "";
}

const chip = "pressable focus-ring tap-target shrink-0 rounded-control border px-3.5 py-2 text-subhead font-medium";
const chipOn = "border-action bg-action text-on-action";
const chipOff = "border-separator bg-surface-muted text-ink hover:border-field-border";
// RandevuN palette: emerald accent only for the confirmation moment (selected time + final submit).
const slotOn = "border-accent-ink bg-accent-soft font-semibold text-on-accent-soft shadow-[inset_0_0_0_1px_var(--color-accent-ink)]";

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0 text-action">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`size-5 shrink-0 ${back ? "rotate-180" : ""}`}>
      <path d="M7.5 4.5l5.5 5.5-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "30 dk · ₺450": the customer sees the service time and price; the buffer stays internal (#189). */
function serviceMinutes(service: ServiceOption) {
  return [`${service.durationMinutes} dk`, formatServicePrice(service.priceMinor, service.priceIsFrom)].filter(Boolean).join(" · ");
}

export function PublicBookingForm({
  slug,
  legal,
  location = null,
  services,
  categories = [],
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
  /** Owner decision 2026-11-06: service groups shown as headed lists in step 1. */
  categories?: ReadonlyArray<CategoryOption>;
  staff: ReadonlyArray<StaffOption>;
  timeZone: string;
  minDate: string;
  initialServiceId: string;
}) {
  const [step, setStep] = useState<BookingStep>(() => initialStep(initialServiceId));
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [staffId, setStaffId] = useState(() => initialStaffId(staff));
  const [dateIso, setDateIso] = useState(minDate);
  const [slots, setSlots] = useState<ReadonlyArray<Slot>>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState<AvailabilityStatus>(() =>
    initialServiceId && initialStaffId(staff) ? "loading" : "idle",
  );
  const [status, setStatus] = useState("");
  const [booked, setBooked] = useState<BookingSummary | null>(null);
  const [phone, setPhone] = useState("");
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const [stale, setStale] = useState(false);
  const hasPhone = phone.trim() !== "";
  const [busy, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const selectedService = useMemo(() => services.find((service) => service.id === serviceId), [services, serviceId]);
  const selectedStaff = useMemo(() => staff.find((member) => member.id === staffId), [staff, staffId]);
  const serviceGroups = useMemo(() => groupServicesByCategory(categories, services), [categories, services]);
  const days = useMemo(() => dateStrip(minDate, 14), [minDate]);
  const slotGroups = useMemo(() => groupSlots(slots, timeZone), [slots, timeZone]);

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

  // Each step change starts at the top with focus on the step title (screen readers hear the new step).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [step]);

  function goTo(next: BookingStep) {
    haptic("selection");
    setStep(next);
  }

  function chooseService(id: string) {
    setServiceId(id);
    setSelectedSlot("");
    setStatus("");
    setAvailabilityStatus(id && staffId && dateIso ? "loading" : "idle");
    goTo(2);
  }

  function chooseStaff(id: string) {
    haptic("selection");
    setStaffId(id);
    setSelectedSlot("");
    setAvailabilityStatus(id && serviceId && dateIso ? "loading" : "idle");
  }

  function chooseDate(iso: string) {
    if (!iso) return;
    haptic("selection");
    setDateIso(iso);
    setSelectedSlot("");
    setAvailabilityStatus(serviceId && staffId ? "loading" : "idle");
  }

  const canContinue = step === 1 ? Boolean(selectedService) : step === 2 ? Boolean(selectedSlot) && availabilityStatus === "ready" : true;

  function submit(formData: FormData) {
    if (!selectedSlot) {
      setStatus("Lütfen uygun bir saat seçin.");
      setStep(2);
      return;
    }

    const optedIn = whatsappOptIn && hasPhone;
    setStatus("");
    setPhoneError(false);
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
        haptic("success");
        const statusPath = "statusPath" in result && typeof result.statusPath === "string" ? result.statusPath : "";
        setBooked({
          serviceName: selectedService?.name ?? "",
          staffName: selectedStaff?.displayName ?? "",
          startAtIso: selectedSlot,
          timeZone,
          statusUrl: statusPath ? `${window.location.origin}${statusPath}` : "",
        });
        setSelectedSlot("");
        setSlots((current) => current.filter((slot) => slot.startAtIso !== selectedSlot));
        return;
      }

      haptic("error");
      if (result.status === "SLOT_UNAVAILABLE") {
        setStatus("Bu saat artık uygun değil. Lütfen başka bir saat seçin.");
        setSelectedSlot("");
        setStep(2);
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
        setStatus("Seçtiğiniz hizmet veya uzman artık uygun değil. Lütfen yeniden seçin.");
        setSelectedSlot("");
        setStep(1);
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

  const timeLabel = selectedSlot ? formatTime(selectedSlot, timeZone) : "";
  const barSummary =
    step === 1
      ? selectedService
        ? `${selectedService.name} · ${selectedService.durationMinutes} dk`
        : "Bir hizmet seçin"
      : step === 2
        ? selectedSlot
          ? `${formatDateLong(dateIso)} · ${timeLabel}`
          : "Bir saat seçin"
        : `${formatDateLong(dateIso)} · ${timeLabel}`;

  if (booked) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto max-w-xl px-4 pb-10 pt-4 sm:px-6">
          <Breadcrumb className="mb-3" items={[{ label: "Salon sayfası", href: `/${encodeURIComponent(slug)}` }, { label: "Randevu al" }]} />
          <BookingConfirmation
            summary={booked}
            onNewBooking={() => {
              setBooked(null);
              setStep(1);
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-xl px-4 pt-4 sm:px-6">
        <Breadcrumb className="mb-3" items={[{ label: "Salon sayfası", href: `/${encodeURIComponent(slug)}` }, { label: "Randevu al" }]} />
        <form
          id="booking-form"
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (step < 3) {
              if (canContinue) goTo((step + 1) as BookingStep);
              return;
            }
            submit(new FormData(event.currentTarget));
          }}
        >
          <header className="space-y-3">
            <div className="flex min-h-11 items-center gap-2">
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => goTo((step - 1) as BookingStep)}
                  className="pressable focus-ring tap-target -ml-2 inline-flex items-center gap-0.5 rounded-control px-2 text-body text-action"
                >
                  <Chevron back />
                  Geri
                </button>
              )}
              <p className="ml-auto text-footnote font-medium tabular-nums text-ink-muted">Adım {step} / 3</p>
            </div>
            <div aria-hidden="true" className="grid grid-cols-3 gap-1.5">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`h-1 rounded-full ${n <= step ? "bg-action" : "bg-separator"}`} />
              ))}
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="text-large-title outline-none">
              {BOOKING_STEP_TITLES[step]}
            </h1>
            {step === 1 && location && <SalonLocationLink location={location} />}
          </header>

          {status && <p role="status" className={statusNote}>{status}</p>}

          {step === 1 && (
            services.length === 0 ? (
              <p className={`${card} text-subhead text-ink-muted`}>
                Bu salon henüz online randevuya açık bir hizmet eklemedi. Lütfen salonla doğrudan iletişime geçin.
              </p>
            ) : (
              <div className="space-y-5">
                {serviceGroups.map((group) => (
                  <section key={group.id ?? "none"} aria-label={group.name ?? "Hizmetler"} className="space-y-1.5">
                    {group.name && <h2 className="px-4 text-footnote font-semibold uppercase text-ink-muted">{group.name}</h2>}
                    <ul className="inset-group divide-y divide-separator overflow-hidden">
                      {group.services.map((service) => {
                        const selected = service.id === serviceId;
                        const price = formatServicePrice(service.priceMinor, service.priceIsFrom);
                        return (
                          <li key={service.id}>
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() => chooseService(service.id)}
                              className="pressable focus-ring flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block text-body font-medium text-ink">{service.name}</span>
                                <span className="block text-footnote tabular-nums text-ink-muted">{service.durationMinutes} dk</span>
                              </span>
                              {price && <span className="shrink-0 text-subhead font-medium tabular-nums text-ink">{price}</span>}
                              {selected ? <Check /> : <span className="text-ink-muted"><Chevron /></span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )
          )}

          {step === 2 && (
            <>
              {selectedService && (
                <button
                  type="button"
                  onClick={() => goTo(1)}
                  className={`${card} pressable focus-ring flex w-full items-center gap-3 text-left`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-footnote text-ink-muted">Hizmet</span>
                    <span className="block text-body font-medium">{selectedService.name}</span>
                    <span className="block text-footnote tabular-nums text-ink-muted">{serviceMinutes(selectedService)}</span>
                  </span>
                  <span className="text-subhead font-medium text-action">Değiştir</span>
                </button>
              )}

              <section aria-labelledby="staff-title" className="space-y-2">
                <h2 id="staff-title" className="px-1 text-headline">Uzman</h2>
                {staff.length === 0 ? (
                  <p className="px-1 text-subhead text-ink-muted">Şu anda online randevu alan uzman yok.</p>
                ) : staff.length === 1 ? (
                  <p className="px-1 text-body">{staff[0].displayName}</p>
                ) : (
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                    {staff.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        aria-pressed={member.id === staffId}
                        onClick={() => chooseStaff(member.id)}
                        className={`${chip} ${member.id === staffId ? chipOn : chipOff}`}
                      >
                        {member.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section aria-labelledby="date-title" className="space-y-2">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 id="date-title" className="text-headline">Tarih</h2>
                  <span className="text-footnote text-ink-muted">{formatDateLong(dateIso)}</span>
                </div>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                  {days.map((day) => {
                    const selected = day.iso === dateIso;
                    return (
                      <button
                        key={day.iso}
                        type="button"
                        aria-pressed={selected}
                        aria-label={formatDateLong(day.iso)}
                        onClick={() => chooseDate(day.iso)}
                        className={`pressable focus-ring flex w-14 shrink-0 flex-col items-center rounded-control border py-2 ${selected ? chipOn : chipOff}`}
                      >
                        <span className={`text-caption uppercase ${selected ? "" : "text-ink-muted"}`}>{day.weekday}</span>
                        <span className="text-headline tabular-nums">{day.day}</span>
                        <span className={`text-caption ${selected ? "" : "text-ink-muted"}`}>{day.month}</span>
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-3 px-1">
                  <span className="text-subhead text-ink-muted">Başka bir tarih</span>
                  <input
                    name="date"
                    type="date"
                    min={minDate}
                    value={dateIso}
                    onChange={(event) => chooseDate(event.target.value)}
                    className="focus-ring tap-target rounded-control border border-field-border bg-surface-muted px-3 text-subhead tabular-nums text-ink"
                  />
                </label>
              </section>

              <section aria-labelledby="slots-title" aria-live="polite" className={`${card} space-y-4`}>
                <h2 id="slots-title" className="text-headline">Uygun saatler</h2>
                {availabilityStatus === "idle" && <p className="text-subhead text-ink-muted">Saatleri görmek için bir uzman seçin.</p>}
                {availabilityStatus === "loading" && <p className="text-subhead text-ink-muted">Uygun saatler kontrol ediliyor…</p>}
                {availabilityStatus === "empty" && <p className="text-subhead text-ink-muted">Bu tarih için uygun saat yok. Başka bir gün seçin.</p>}
                {availabilityStatus === "error" && <p className="text-subhead text-ink-muted">Uygun saatler yüklenemedi. Lütfen tekrar deneyin.</p>}
                {availabilityStatus === "inactive" && <p className="text-subhead text-ink-muted">Şu anda online randevu alınmıyor.</p>}
                {availabilityStatus === "limited" && <p className="text-subhead text-ink-muted">Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.</p>}
                {availabilityStatus === "ready" &&
                  slotGroups.map((group) => (
                    <div key={group.label} className="space-y-2">
                      <h3 className="text-footnote font-semibold uppercase text-ink-muted">{group.label}</h3>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {group.slots.map((slot) => (
                          <button
                            key={slot.startAtIso}
                            type="button"
                            aria-pressed={selectedSlot === slot.startAtIso}
                            onClick={() => {
                              haptic("selection");
                              setSelectedSlot(slot.startAtIso);
                              setStatus("");
                            }}
                            className={`pressable focus-ring tap-target rounded-control border px-2 py-2.5 text-body font-medium tabular-nums ${selectedSlot === slot.startAtIso ? slotOn : chipOff}`}
                          >
                            {formatTime(slot.startAtIso, timeZone)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </section>
            </>
          )}

          {step === 3 && (
            <>
              <dl className={`${card} space-y-3`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <dt className="text-footnote text-ink-muted">Hizmet</dt>
                    <dd className="text-body font-medium">{selectedService?.name}</dd>
                  </div>
                  <button type="button" onClick={() => goTo(1)} className="focus-ring tap-target -my-2 rounded-control px-2 text-subhead font-medium text-action">
                    Değiştir
                  </button>
                </div>
                <div className="flex items-start gap-3 border-t border-separator pt-3">
                  <div className="min-w-0 flex-1">
                    <dt className="text-footnote text-ink-muted">Uzman ve saat</dt>
                    <dd className="text-body font-medium">{selectedStaff?.displayName}</dd>
                    <dd className="text-subhead tabular-nums text-ink-muted">{formatDateLong(dateIso)} · {timeLabel}</dd>
                  </div>
                  <button type="button" onClick={() => goTo(2)} className="focus-ring tap-target -my-2 rounded-control px-2 text-subhead font-medium text-action">
                    Değiştir
                  </button>
                </div>
              </dl>

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

              {stale && (
                <Button type="button" onClick={() => window.location.reload()} variant="secondary" className="w-full">
                  Sayfayı yenile
                </Button>
              )}
            </>
          )}
        </form>

        {/* Room for the fixed bar so the last field is never hidden behind it. */}
        <div aria-hidden="true" className="h-[calc(6rem+env(safe-area-inset-bottom))]" />
      </div>

      <div
        data-booking-bar=""
        className="glass fixed inset-x-0 bottom-0 z-40 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto flex max-w-xl items-center gap-3 sm:px-2">
          <p className="min-w-0 flex-1 truncate text-subhead font-medium tabular-nums text-ink" aria-live="polite">
            {barSummary}
          </p>
          <Button
            type="submit"
            form="booking-form"
            variant={step === 3 ? "accent" : "primary"}
            disabled={step === 3 ? busy || stale || !selectedSlot : !canContinue}
            aria-describedby={step === 3 ? "booking-notice" : undefined}
            className="shrink-0"
          >
            {step === 3 ? (busy ? "Gönderiliyor…" : "Randevu talebi gönder") : "Devam"}
          </Button>
        </div>
      </div>
    </main>
  );
}

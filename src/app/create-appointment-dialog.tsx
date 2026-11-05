"use client";

// WP-08: "Randevu oluştur" flow shared by the admin and staff calendars.
// The UI never sends tenantId; the staff variant never sends staffId.
// Slots shown here are a hint only — the server re-validates on create.

import { useId, useRef, useState, useTransition } from "react";

import type {
  AdminCreateAppointmentInput,
  CreateAppointmentResult,
  CreateOptionsView,
  CustomerSearchResultView,
  LocalDateIso,
  SlotListResult,
  SlotView,
  StaffCreateAppointmentInput,
} from "./appointment-create-contract";
import { buttonPrimary, buttonSecondary } from "./_ui/styles";

type AdminVariant = Readonly<{
  kind: "admin";
  loadOptions: () => Promise<CreateOptionsView | null>;
  listSlots: (input: { serviceId: string; staffId: string; date: LocalDateIso }) => Promise<SlotListResult>;
  searchCustomers: (query: string) => Promise<ReadonlyArray<CustomerSearchResultView>>;
  create: (input: AdminCreateAppointmentInput) => Promise<CreateAppointmentResult>;
}>;

type StaffVariant = Readonly<{
  kind: "staff";
  loadOptions: () => Promise<CreateOptionsView | null>;
  listSlots: (input: { serviceId: string; date: LocalDateIso }) => Promise<SlotListResult>;
  create: (input: StaffCreateAppointmentInput) => Promise<CreateAppointmentResult>;
}>;

type Props = Readonly<{
  variant: AdminVariant | StaffVariant;
  /** Calendar's currently selected local date, used as the default. */
  initialDate: LocalDateIso;
  onCreated: (result: { date: LocalDateIso; notified: boolean }) => void;
}>;

type SlotsState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; slots: ReadonlyArray<SlotView> }
  | { state: "error"; message: string };

const slotErrors: Record<string, string> = {
  CLOSED_DATE: "Bu tarih kapalı. Başka bir tarih seçin.",
  TENANT_INACTIVE: "Salon pasif durumda; yeni randevu oluşturulamaz.",
  INVALID_INPUT: "Seçimleri kontrol edin.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
};

const createErrors: Record<string, string> = {
  SLOT_UNAVAILABLE: "Bu saat artık uygun değil. Başka bir saat seçin. Saatler yenilendi.",
  CLOSED_DATE: "Bu tarih kapalı. Başka bir tarih seçin.",
  TENANT_INACTIVE: "Salon pasif durumda; yeni randevu oluşturulamaz.",
  CUSTOMER_NOT_FOUND: "Seçilen müşteri bulunamadı. Müşteriyi yeniden arayın.",
  INVALID_INPUT: "Bilgileri kontrol edin. Telefonu ülke koduyla girin, örn. +905551234567.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  OPT_IN_REQUIRES_PHONE: "WhatsApp izni için müşterinin telefon numarası gerekli. Telefonu girin veya izin kutusunun işaretini kaldırın.",
};

const inputClassName =
  "w-full min-h-11 rounded-lg border border-field-border bg-surface px-3 py-2 text-sm text-ink focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/30 disabled:bg-surface-muted";

/** Today's local calendar date in the tenant timezone. */
function todayIn(timeZone: string): LocalDateIso {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

/** Formats a local YYYY-MM-DD without any timezone shift. */
export function formatLocalDate(date: LocalDateIso): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function CreateAppointmentDialog({ variant, initialDate, onCreated }: Props) {
  const isAdmin = variant.kind === "admin";
  const titleId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const slotRequest = useRef(0);
  const searchRequest = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitting, startSubmit] = useTransition();
  const [options, setOptions] = useState<CreateOptionsView | null>(null);
  const [optionsState, setOptionsState] = useState<"loading" | "ready" | "error">("loading");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(initialDate);
  const [slots, setSlots] = useState<SlotsState>({ state: "idle" });
  const [startAt, setStartAt] = useState("");

  const [customerMode, setCustomerMode] = useState<"existing" | "guest">(isAdmin ? "existing" : "guest");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReadonlyArray<CustomerSearchResultView>>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [selected, setSelected] = useState<CustomerSearchResultView | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [notify, setNotify] = useState(true);
  // WP-10: staff-recorded verbal WhatsApp opt-in. Unchecked by default; requires a phone.
  const [verbalOptIn, setVerbalOptIn] = useState(false);

  const [error, setError] = useState("");
  const [emailExists, setEmailExists] = useState<CustomerSearchResultView | null>(null);

  const today = options ? todayIn(options.timezone) : undefined;
  const service = options?.services.find((s) => s.id === serviceId);
  const staffMember = options?.staff.find((s) => s.id === staffId);
  const slot = slots.state === "ok" ? slots.slots.find((s) => s.startAt === startAt) : undefined;

  const hasPhone = customerMode === "existing" ? Boolean(selected?.phone) : guestPhone.trim() !== "";

  function loadSlots(next: { serviceId: string; staffId: string; date: string }) {
    setStartAt("");
    if (!next.serviceId || !next.date || (isAdmin && !next.staffId)) {
      setSlots({ state: "idle" });
      return;
    }
    const request = ++slotRequest.current;
    setSlots({ state: "loading" });
    const promise =
      variant.kind === "admin"
        ? variant.listSlots({ serviceId: next.serviceId, staffId: next.staffId, date: next.date })
        : variant.listSlots({ serviceId: next.serviceId, date: next.date });
    promise
      .then((result) => {
        if (request !== slotRequest.current) return;
        if (result.status === "OK") setSlots({ state: "ok", slots: result.slots });
        else setSlots({ state: "error", message: slotErrors[result.status] ?? "Saatler yüklenemedi." });
      })
      .catch(() => {
        if (request === slotRequest.current) setSlots({ state: "error", message: "Saatler yüklenemedi. Tekrar deneyin." });
      });
  }

  function resetForm() {
    slotRequest.current++;
    searchRequest.current++;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setOptions(null);
    setOptionsState("loading");
    setServiceId("");
    setStaffId("");
    setSlots({ state: "idle" });
    setStartAt("");
    setCustomerMode(isAdmin ? "existing" : "guest");
    setQuery("");
    setResults([]);
    setSearchState("idle");
    setSelected(null);
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
    setNotify(true);
    setVerbalOptIn(false);
    setError("");
    setEmailExists(null);
  }

  function openDialog() {
    resetForm();
    dialogRef.current?.showModal();
    headingRef.current?.focus();
    variant
      .loadOptions()
      .then((result) => {
        if (!result) {
          setOptionsState("error");
          return;
        }
        const minDate = todayIn(result.timezone);
        const nextDate = initialDate < minDate ? minDate : initialDate;
        const nextService = result.services.length === 1 ? result.services[0].id : "";
        const nextStaff = result.staff.length === 1 ? result.staff[0].id : "";
        setOptions(result);
        setOptionsState("ready");
        setDate(nextDate);
        setServiceId(nextService);
        setStaffId(nextStaff);
        loadSlots({ serviceId: nextService, staffId: nextStaff, date: nextDate });
      })
      .catch(() => setOptionsState("error"));
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function onQueryChange(value: string) {
    setQuery(value);
    setSelected(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const request = ++searchRequest.current;
    if (variant.kind !== "admin" || value.trim().length < 2) {
      setResults([]);
      setSearchState("idle");
      return;
    }
    const search = variant.searchCustomers;
    setSearchState("loading");
    searchTimer.current = setTimeout(() => {
      search(value.trim())
        .then((found) => {
          if (request !== searchRequest.current) return;
          setResults(found);
          setSearchState("done");
        })
        .catch(() => {
          if (request === searchRequest.current) setSearchState("error");
        });
    }, 300);
  }

  function submit(override?: CustomerSearchResultView) {
    setError("");
    if (!service || !slot || (isAdmin && !staffId)) {
      setError("Hizmet, tarih ve saat seçin.");
      return;
    }
    const existing = override ?? (customerMode === "existing" ? selected : null);
    if (!existing && customerMode === "existing" && !override) {
      setError("Bir müşteri seçin veya yeni müşteri girin.");
      return;
    }
    if (!existing && guestName.trim() === "") {
      setError("Müşteri adı gerekli.");
      return;
    }
    const phone = guestPhone.trim();
    const email = guestEmail.trim();
    const customerHasPhone = existing ? Boolean(existing.phone) : phone !== "";
    const notifyCustomer = notify && customerHasPhone;
    const whatsappVerbalOptIn = verbalOptIn && customerHasPhone;
    const chosenDate = date;

    startSubmit(async () => {
      let result: CreateAppointmentResult;
      try {
        if (variant.kind === "admin") {
          result = await variant.create({
            serviceId: service.id,
            staffId,
            startAt: slot.startAt,
            customer: existing
              ? { kind: "existing", profileId: existing.profileId }
              : { kind: "guest", displayName: guestName.trim(), ...(phone ? { phone } : {}), ...(email ? { email } : {}) },
            notifyCustomer,
            whatsappVerbalOptIn,
          });
        } else {
          result = await variant.create({
            serviceId: service.id,
            startAt: slot.startAt,
            customer: { kind: "guest", displayName: guestName.trim(), ...(phone ? { phone } : {}) },
            notifyCustomer,
            whatsappVerbalOptIn,
          });
        }
      } catch {
        setError("Randevu oluşturulamadı. Tekrar deneyin.");
        return;
      }

      if (result.status === "CREATED") {
        closeDialog();
        onCreated({ date: chosenDate, notified: result.notified });
        return;
      }
      if (result.status === "EMAIL_EXISTS") {
        setEmailExists(result.existing);
        setError("Bu e-posta adresi kayıtlı bir müşteriye ait.");
        return;
      }
      setError(createErrors[result.status] ?? "Randevu oluşturulamadı.");
      if (result.status === "SLOT_UNAVAILABLE" || result.status === "CLOSED_DATE") {
        loadSlots({ serviceId, staffId, date });
      }
      if (result.status === "CUSTOMER_NOT_FOUND") setSelected(null);
    });
  }

  function continueWithExisting(customer: CustomerSearchResultView) {
    setEmailExists(null);
    setCustomerMode("existing");
    setSelected(customer);
    setQuery(customer.displayName);
    setResults([]);
    setSearchState("idle");
    submit(customer);
  }


  return (
    <>
      <button ref={triggerRef} type="button" onClick={openDialog} className={buttonPrimary}>
        Randevu oluştur
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => {
          slotRequest.current++;
          searchRequest.current++;
          if (searchTimer.current) clearTimeout(searchTimer.current);
          triggerRef.current?.focus();
        }}
        className="m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-sheet border-0 bg-surface p-0 text-ink shadow-sheet backdrop:bg-black/40 backdrop:backdrop-blur-sm"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-separator bg-surface px-4 py-3">
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            Randevu oluştur
          </h2>
          <button type="button" onClick={closeDialog} className={buttonSecondary}>
            Kapat
          </button>
        </div>

        <form
          className="space-y-5 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          noValidate
        >
          <p className="text-sm text-ink-muted">
            {isAdmin
              ? "Oluşturulan randevu doğrudan onaylı olarak kaydedilir."
              : "Randevu sizin adınıza, onaylı olarak kaydedilir."}
          </p>

          {optionsState === "loading" && (
            <p role="status" className="text-sm text-ink-muted">
              Seçenekler yükleniyor…
            </p>
          )}

          {optionsState === "error" && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-status-rejected-bg p-3 text-sm text-status-rejected">
              Randevu seçenekleri yüklenemedi. Yetkinizi kontrol edin veya daha sonra tekrar deneyin.
            </p>
          )}

          {optionsState === "ready" && options && options.services.length === 0 && (
            <p className="rounded-lg border border-separator bg-surface-muted p-3 text-sm text-ink-muted">
              Aktif hizmet yok. {isAdmin ? "Önce İşletme yönetimi sayfasından bir hizmet ekleyin." : "İşletme yöneticinizden hizmet eklemesini isteyin."}
            </p>
          )}

          {optionsState === "ready" && options && options.services.length > 0 && (
            <>
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">1. Hizmet ve zaman</legend>

                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-service`} className="text-sm font-medium">
                    Hizmet
                  </label>
                  <select
                    id={`${fieldId}-service`}
                    value={serviceId}
                    onChange={(e) => {
                      setServiceId(e.target.value);
                      loadSlots({ serviceId: e.target.value, staffId, date });
                    }}
                    className={inputClassName}
                  >
                    <option value="">Hizmet seçin</option>
                    {options.services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.durationMinutes} dk
                      </option>
                    ))}
                  </select>
                </div>

                {isAdmin && (
                  <div className="space-y-1">
                    <label htmlFor={`${fieldId}-staff`} className="text-sm font-medium">
                      Personel
                    </label>
                    {options.staff.length === 0 ? (
                      <p className="text-sm text-ink-muted">Aktif personel yok. Önce personel ekleyin.</p>
                    ) : (
                      <select
                        id={`${fieldId}-staff`}
                        value={staffId}
                        onChange={(e) => {
                          setStaffId(e.target.value);
                          loadSlots({ serviceId, staffId: e.target.value, date });
                        }}
                        className={inputClassName}
                      >
                        <option value="">Personel seçin</option>
                        {options.staff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <label htmlFor={`${fieldId}-date`} className="text-sm font-medium">
                    Tarih
                  </label>
                  <input
                    id={`${fieldId}-date`}
                    type="date"
                    min={today}
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      loadSlots({ serviceId, staffId, date: e.target.value });
                    }}
                    className={inputClassName}
                  />
                </div>

                <div role="group" aria-labelledby={`${fieldId}-slots-label`} aria-busy={slots.state === "loading"}>
                  <p id={`${fieldId}-slots-label`} className="text-sm font-medium">
                    Saat
                  </p>
                  <div aria-live="polite" className="mt-1 min-h-11">
                    {slots.state === "idle" && (
                      <p className="text-sm text-ink-muted">
                        {isAdmin ? "Uygun saatleri görmek için hizmet, personel ve tarih seçin." : "Uygun saatleri görmek için hizmet ve tarih seçin."}
                      </p>
                    )}
                    {slots.state === "loading" && <p className="text-sm text-ink-muted">Uygun saatler yükleniyor…</p>}
                    {slots.state === "error" && <p className="text-sm font-medium text-destructive">{slots.message}</p>}
                    {slots.state === "ok" && slots.slots.length === 0 && (
                      <p className="text-sm text-ink-muted">Bu tarihte uygun saat yok. Başka bir tarih seçin.</p>
                    )}
                  </div>
                  {slots.state === "ok" && slots.slots.length > 0 && (
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {slots.slots.map((s) => {
                        const isSelected = s.startAt === startAt;
                        return (
                          <button
                            key={s.startAt}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setStartAt(s.startAt)}
                            className={`min-h-11 rounded-lg border px-2 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 ${
                              isSelected ? "border-action bg-action text-on-action" : "border-separator bg-surface text-ink hover:bg-surface-muted"
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">2. Müşteri</legend>

                {isAdmin && (
                  <div className="flex gap-4" role="radiogroup" aria-label="Müşteri türü">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${fieldId}-mode`}
                        checked={customerMode === "existing"}
                        onChange={() => setCustomerMode("existing")}
                        className="h-4 w-4"
                      />
                      Kayıtlı müşteri
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`${fieldId}-mode`}
                        checked={customerMode === "guest"}
                        onChange={() => setCustomerMode("guest")}
                        className="h-4 w-4"
                      />
                      Yeni müşteri
                    </label>
                  </div>
                )}

                {isAdmin && customerMode === "existing" && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-search`} className="text-sm font-medium">
                        Müşteri ara
                      </label>
                      <input
                        id={`${fieldId}-search`}
                        type="search"
                        autoComplete="off"
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        aria-describedby={`${fieldId}-search-hint`}
                        className={inputClassName}
                      />
                      <p id={`${fieldId}-search-hint`} className="text-xs text-ink-muted">
                        Ad, telefon veya e-posta ile en az 2 karakter girin.
                      </p>
                    </div>

                    <div aria-live="polite">
                      {searchState === "loading" && <p className="text-sm text-ink-muted">Aranıyor…</p>}
                      {searchState === "error" && <p className="text-sm font-medium text-destructive">Arama yapılamadı. Tekrar deneyin.</p>}
                      {searchState === "done" && results.length === 0 && !selected && (
                        <p className="text-sm text-ink-muted">Müşteri bulunamadı. &quot;Yeni müşteri&quot; seçeneğiyle devam edebilirsiniz.</p>
                      )}
                      {selected && (
                        <p className="text-sm">
                          Seçilen müşteri: <span className="font-medium">{selected.displayName}</span>
                        </p>
                      )}
                    </div>

                    {!selected && results.length > 0 && (
                      <ul className="divide-y divide-separator rounded-lg border border-separator" aria-label="Arama sonuçları">
                        {results.map((c) => (
                          <li key={c.profileId}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelected(c);
                                setResults([]);
                                setSearchState("idle");
                              }}
                              className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                            >
                              <span className="font-medium">{c.displayName}</span>
                              <span className="block text-xs text-ink-muted">
                                {[c.phone, c.email].filter(Boolean).join(" · ") || "İletişim bilgisi yok"}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {customerMode === "guest" && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
                        Ad soyad <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id={`${fieldId}-name`}
                        required
                        aria-required="true"
                        maxLength={120}
                        autoComplete="off"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        className={inputClassName}
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-phone`} className="text-sm font-medium">
                        Telefon (isteğe bağlı)
                      </label>
                      <input
                        id={`${fieldId}-phone`}
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        value={guestPhone}
                        onChange={(e) => {
                          setGuestPhone(e.target.value);
                          if (e.target.value.trim() === "") setVerbalOptIn(false);
                        }}
                        aria-describedby={`${fieldId}-phone-hint`}
                        className={inputClassName}
                      />
                      <p id={`${fieldId}-phone-hint`} className="text-xs text-ink-muted">
                        Ülke koduyla girin, örn. +905551234567.
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="space-y-1">
                        <label htmlFor={`${fieldId}-email`} className="text-sm font-medium">
                          E-posta (isteğe bağlı)
                        </label>
                        <input
                          id={`${fieldId}-email`}
                          type="email"
                          autoComplete="off"
                          value={guestEmail}
                          onChange={(e) => {
                            setGuestEmail(e.target.value);
                            setEmailExists(null);
                          }}
                          className={inputClassName}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={notify && hasPhone}
                      disabled={!hasPhone}
                      onChange={(e) => setNotify(e.target.checked)}
                      aria-describedby={`${fieldId}-notify-hint`}
                      className="h-4 w-4"
                    />
                    Müşteriyi bilgilendir
                  </label>
                  <p id={`${fieldId}-notify-hint`} className="text-xs text-ink-muted">
                    {hasPhone
                      ? "Randevu onay mesajı WhatsApp ile, yalnızca müşterinin izni kayıtlıysa gönderilir."
                      : "Bildirim için müşterinin telefon numarası gerekli."}
                  </p>
                </div>

                <div>
                  <label className="flex min-h-11 items-start gap-2 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={verbalOptIn && hasPhone}
                      disabled={!hasPhone}
                      onChange={(e) => setVerbalOptIn(e.target.checked)}
                      aria-describedby={`${fieldId}-optin-hint`}
                      className="mt-0.5 h-4 w-4 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
                    />
                    <span className={hasPhone ? "" : "text-ink-muted"}>{options.verbalOptIn.label}</span>
                  </label>
                  <p id={`${fieldId}-optin-hint`} className="text-xs text-ink-muted">
                    {hasPhone
                      ? "Yalnızca müşteri izin verdiyse işaretleyin. Kaydı sizin adınıza tutulur."
                      : "İzin kaydı için müşterinin telefon numarası gerekli."}
                  </p>
                </div>
              </fieldset>

              {service && slot && (isAdmin ? staffMember : true) && (
                <p className="rounded-lg border border-separator bg-surface-muted p-3 text-sm">
                  <span className="font-medium">{service.name}</span>
                  {isAdmin && staffMember ? ` · ${staffMember.displayName}` : ""} · {formatLocalDate(date)} {slot.label} ·{" "}
                  {service.durationMinutes} dk
                </p>
              )}

              <div aria-live="assertive" role="alert">
                {error && (
                  <div className="rounded-lg border border-destructive/40 bg-status-rejected-bg p-3 text-sm text-status-rejected">
                    <p className="font-medium">{error}</p>
                    {emailExists && (
                      <div className="mt-2 space-y-2">
                        <p>
                          {emailExists.displayName}
                          {emailExists.email ? ` (${emailExists.email})` : ""}
                        </p>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => continueWithExisting(emailExists)}
                          className={buttonSecondary}
                        >
                          Bu kayıtlı müşteriyle devam et
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-separator pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeDialog} className={buttonSecondary}>
                  Vazgeç
                </button>
                <button type="submit" disabled={submitting || !slot} className={buttonPrimary}>
                  {submitting ? "Oluşturuluyor…" : "Randevuyu oluştur"}
                </button>
              </div>
              {!slot && <p className="text-right text-xs text-ink-muted">Randevuyu oluşturmak için bir saat seçin.</p>}
            </>
          )}
        </form>
      </dialog>
    </>
  );
}

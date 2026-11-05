"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { TenantLegalErrorCode, TenantLegalFields } from "../legal-consent-contract";
import { updateTenantSettingsAction } from "./settings-actions";

type TenantSettingsView = Readonly<{
  name: string;
  contactPhone: string | null;
  status: "ACTIVE" | "INACTIVE";
  timezone: string;
  /** WP-10: salon legal fields used in the KVKK notice. */
  legal: TenantLegalFields;
  /** Customer-facing address + optional maps share link (public "Yol tarifi al" link). */
  location: Readonly<{ publicAddress: string | null; mapsUrl: string | null }>;
}>;

const legalErrorMessages: Record<TenantLegalErrorCode, string> = {
  INVALID_LEGAL_NAME: "Ticari unvanı kontrol edin.",
  INVALID_LEGAL_ADDRESS: "Adresi kontrol edin.",
  INVALID_KVKK_EMAIL: "KVKK başvuru e-postası geçersiz. Örn. kvkk@salonunuz.com",
};

const errorMessages: Record<string, string> = {
  INVALID_TENANT_NAME: "Salon adını kontrol edin.",
  INVALID_CONTACT_PHONE:
    "Telefon numarası geçersiz. Ülke koduyla girin, örn. +905551234567.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  PERSISTENCE_FAILURE: "Ayarlar kaydedilemedi. Lütfen tekrar deneyin.",
  INVALID_PUBLIC_ADDRESS: "Salon adresini kontrol edin (en fazla 300 karakter).",
  INVALID_MAPS_URL:
    "Harita bağlantısı geçersiz. Google Haritalar veya Apple Haritalar'daki Paylaş bağlantısını yapıştırın.",
  ...legalErrorMessages,
};

const inputClassName =
  "w-full rounded-lg border border-field-border bg-surface px-3 py-2 text-sm text-ink shadow-sm focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/30 aria-[invalid=true]:border-destructive";

export function TenantSettingsForm({ settings, canEdit = false }: { settings: TenantSettingsView; canEdit?: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string; code?: string } | null>(null);

  const nameInvalid = feedback?.code === "INVALID_TENANT_NAME";
  const phoneInvalid = feedback?.code === "INVALID_CONTACT_PHONE";
  const legalNameInvalid = feedback?.code === "INVALID_LEGAL_NAME";
  const legalAddressInvalid = feedback?.code === "INVALID_LEGAL_ADDRESS";
  const kvkkEmailInvalid = feedback?.code === "INVALID_KVKK_EMAIL";
  const publicAddressInvalid = feedback?.code === "INVALID_PUBLIC_ADDRESS";
  const mapsUrlInvalid = feedback?.code === "INVALID_MAPS_URL";
  const legal = settings.legal;
  const location = settings.location;
  const legalComplete = Boolean(legal.legalName && legal.legalAddress && legal.kvkkContactEmail);

  return (
    <section
      aria-labelledby="tenant-settings-title"
      className="mt-6 rounded-xl border border-separator bg-surface p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tenant-settings-title" className="text-lg font-semibold">
          Salon ayarları
        </h2>
        <span
          className={`rounded-full border px-2 py-1 text-xs font-medium ${
            settings.status === "ACTIVE"
              ? "border-status-confirmed/40 bg-status-confirmed-bg text-status-confirmed"
              : "border-status-pending/40 bg-status-pending-bg text-status-pending"
          }`}
        >
          Durum: {settings.status === "ACTIVE" ? "Aktif" : "Pasif"}
        </span>
      </div>

      <form
        key={`${settings.name}|${settings.contactPhone ?? ""}|${legal.legalName ?? ""}|${legal.legalAddress ?? ""}|${legal.kvkkContactEmail ?? ""}|${location.publicAddress ?? ""}|${location.mapsUrl ?? ""}`}
        className="mt-4 grid gap-4 sm:grid-cols-2"
        action={(formData) =>
          startTransition(async () => {
            try {
              const result = await updateTenantSettingsAction(formData);
              if (result.ok) {
                setFeedback({ kind: "success", text: "Salon ayarları kaydedildi." });
                router.refresh();
              } else {
                setFeedback({
                  kind: "error",
                  code: result.code,
                  text: errorMessages[result.code] ?? "Ayarlar kaydedilemedi.",
                });
              }
            } catch {
              setFeedback({ kind: "error", text: "Ayarlar kaydedilemedi. Lütfen tekrar deneyin." });
            }
          })
        }
      >
        <div className="space-y-1">
          <label htmlFor="tenant-name" className="text-sm font-medium">
            Salon adı
          </label>
          <input
            id="tenant-name"
            name="name"
            required
            defaultValue={settings.name}
            readOnly={!canEdit}
            aria-invalid={nameInvalid}
            aria-describedby={nameInvalid ? "tenant-settings-feedback" : undefined}
            className={inputClassName}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="tenant-contact-phone" className="text-sm font-medium">
            İletişim telefonu
          </label>
          <input
            id="tenant-contact-phone"
            name="contactPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={settings.contactPhone ?? ""}
            readOnly={!canEdit}
            aria-invalid={phoneInvalid}
            aria-describedby={
              phoneInvalid
                ? "tenant-contact-phone-help tenant-settings-feedback"
                : "tenant-contact-phone-help"
            }
            className={inputClassName}
          />
          <p id="tenant-contact-phone-help" className="text-xs text-ink-muted">
            Örn. +905551234567. Müşteriler salon sayfasında bu numaraya WhatsApp&apos;tan yazabilir. Boş bırakırsanız WhatsApp bağlantısı gösterilmez.
          </p>
        </div>

        <fieldset className="grid gap-4 border-t border-separator pt-4 sm:col-span-2 sm:grid-cols-2" aria-describedby="tenant-location-help">
          <legend className="text-base font-semibold">Konum</legend>
          <p id="tenant-location-help" className="text-xs text-ink-muted sm:col-span-2">
            Müşteriler salon ve randevu sayfasında &quot;Yol tarifi al&quot; bağlantısıyla salonunuza kolayca ulaşır.
            Harita bağlantısı boşsa adres Google Haritalar&apos;da aranır.
          </p>

          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="tenant-public-address" className="text-sm font-medium">
              Salon adresi
            </label>
            <textarea
              id="tenant-public-address"
              name="publicAddress"
              rows={2}
              maxLength={300}
              autoComplete="street-address"
              defaultValue={location.publicAddress ?? ""}
              readOnly={!canEdit}
              aria-invalid={publicAddressInvalid}
              aria-describedby={
                publicAddressInvalid ? "tenant-public-address-help tenant-settings-feedback" : "tenant-public-address-help"
              }
              className={inputClassName}
            />
            <p id="tenant-public-address-help" className="text-xs text-ink-muted">
              Müşterilere gösterilen adres. Örn. Moda Cad. No:12, Kadıköy / İstanbul
            </p>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="tenant-maps-url" className="text-sm font-medium">
              Harita bağlantısı (isteğe bağlı)
            </label>
            <input
              id="tenant-maps-url"
              name="mapsUrl"
              type="url"
              inputMode="url"
              maxLength={500}
              placeholder="https://maps.app.goo.gl/…"
              defaultValue={location.mapsUrl ?? ""}
              readOnly={!canEdit}
              aria-invalid={mapsUrlInvalid}
              aria-describedby={mapsUrlInvalid ? "tenant-maps-url-help tenant-settings-feedback" : "tenant-maps-url-help"}
              className={inputClassName}
            />
            <p id="tenant-maps-url-help" className="text-xs text-ink-muted">
              Google Haritalar&apos;da salonunuzu açın → Paylaş → Bağlantıyı kopyala. Apple Haritalar bağlantısı da olur.
            </p>
          </div>
        </fieldset>

        <fieldset className="grid gap-4 border-t border-separator pt-4 sm:col-span-2 sm:grid-cols-2" aria-describedby="tenant-legal-help">
          <legend className="text-base font-semibold">Yasal bilgiler (KVKK)</legend>
          <div id="tenant-legal-help" className="space-y-2 text-xs text-ink-muted sm:col-span-2">
            <p>
              Bu bilgiler müşterilere gösterilen aydınlatma metninde veri sorumlusu olarak yer alır. Üç alan da
              doldurulana kadar online randevu kapalı kalır.
            </p>
            <p
              className={`inline-block rounded-md border px-2 py-1 font-medium ${
                legalComplete
                  ? "border-status-confirmed/40 bg-status-confirmed-bg text-status-confirmed"
                  : "border-status-pending/40 bg-status-pending-bg text-status-pending"
              }`}
            >
              {legalComplete ? "Yasal bilgiler tamam." : "Eksik yasal bilgi var: online randevu kapalı."}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="tenant-legal-name" className="text-sm font-medium">
              Ticari unvan
            </label>
            <input
              id="tenant-legal-name"
              name="legalName"
              autoComplete="organization"
              defaultValue={legal.legalName ?? ""}
              readOnly={!canEdit}
              aria-invalid={legalNameInvalid}
              aria-describedby={
                legalNameInvalid ? "tenant-legal-name-help tenant-settings-feedback" : "tenant-legal-name-help"
              }
              className={inputClassName}
            />
            <p id="tenant-legal-name-help" className="text-xs text-ink-muted">
              Vergi levhasındaki ad veya şahıs işletmesinde ad soyad.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="tenant-kvkk-email" className="text-sm font-medium">
              KVKK başvuru e-postası
            </label>
            <input
              id="tenant-kvkk-email"
              name="kvkkContactEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
              defaultValue={legal.kvkkContactEmail ?? ""}
              readOnly={!canEdit}
              aria-invalid={kvkkEmailInvalid}
              aria-describedby={
                kvkkEmailInvalid ? "tenant-kvkk-email-help tenant-settings-feedback" : "tenant-kvkk-email-help"
              }
              className={inputClassName}
            />
            <p id="tenant-kvkk-email-help" className="text-xs text-ink-muted">
              Müşteriler kişisel verileriyle ilgili başvurularını bu adrese gönderir.
            </p>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="tenant-legal-address" className="text-sm font-medium">
              Adres
            </label>
            <textarea
              id="tenant-legal-address"
              name="legalAddress"
              rows={3}
              autoComplete="street-address"
              defaultValue={legal.legalAddress ?? ""}
              readOnly={!canEdit}
              aria-invalid={legalAddressInvalid}
              aria-describedby={legalAddressInvalid ? "tenant-settings-feedback" : undefined}
              className={inputClassName}
            />
          </div>
        </fieldset>

        <dl className="grid gap-4 text-sm sm:col-span-2 sm:grid-cols-2">
          <div>
            <dt className="font-medium">Saat dilimi</dt>
            <dd className="mt-1 text-ink-muted">{settings.timezone}</dd>
          </div>
          <div>
            <dt className="font-medium">Online randevu durumu</dt>
            <dd className="mt-1 text-ink-muted">
              {settings.status === "ACTIVE"
                ? "Aktif — müşteriler online randevu alabilir."
                : "Pasif — online ve yeni randevu alınmıyor."}{" "}
              Durumu yalnızca platform yöneticisi değiştirebilir.
            </dd>
          </div>
        </dl>

        {canEdit ? (
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-full rounded-lg bg-action px-4 py-2 text-sm font-medium text-on-action disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {busy ? "Kaydediliyor…" : "Ayarları kaydet"}
          </button>
        </div>
        ) : (
          <p className="text-xs text-ink-muted sm:col-span-2">Salon ayarlarını yalnızca salon yöneticisi değiştirebilir.</p>
        )}

        <p
          id="tenant-settings-feedback"
          role="status"
          className={`text-sm sm:col-span-2 ${feedback?.kind === "error" ? "text-destructive" : "text-ink-muted"}`}
        >
          {feedback?.text}
        </p>
      </form>
    </section>
  );
}

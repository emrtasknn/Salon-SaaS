"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateTenantSettingsAction } from "./settings-actions";

type TenantSettingsView = Readonly<{
  name: string;
  contactPhone: string | null;
  status: "ACTIVE" | "INACTIVE";
  timezone: string;
}>;

const errorMessages: Record<string, string> = {
  INVALID_TENANT_NAME: "Salon adını kontrol edin.",
  INVALID_CONTACT_PHONE:
    "Telefon numarası geçersiz. Ülke koduyla girin, örn. +905551234567.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  PERSISTENCE_FAILURE: "Ayarlar kaydedilemedi. Lütfen tekrar deneyin.",
};

const inputClassName =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 aria-[invalid=true]:border-red-500";

export function TenantSettingsForm({ settings, canEdit = false }: { settings: TenantSettingsView; canEdit?: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string; code?: string } | null>(null);

  const nameInvalid = feedback?.code === "INVALID_TENANT_NAME";
  const phoneInvalid = feedback?.code === "INVALID_CONTACT_PHONE";

  return (
    <section
      aria-labelledby="tenant-settings-title"
      className="mt-6 rounded-xl border border-zinc-300 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tenant-settings-title" className="text-lg font-semibold">
          Salon ayarları
        </h2>
        <span
          className={`rounded-full border px-2 py-1 text-xs font-medium ${
            settings.status === "ACTIVE"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          Durum: {settings.status === "ACTIVE" ? "Aktif" : "Pasif"}
        </span>
      </div>

      <form
        key={`${settings.name}|${settings.contactPhone ?? ""}`}
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
          <p id="tenant-contact-phone-help" className="text-xs text-zinc-500">
            Örn. +905551234567. Müşteriler salon sayfasında bu numaraya WhatsApp&apos;tan yazabilir. Boş bırakırsanız WhatsApp bağlantısı gösterilmez.
          </p>
        </div>

        <dl className="grid gap-4 text-sm sm:col-span-2 sm:grid-cols-2">
          <div>
            <dt className="font-medium">Saat dilimi</dt>
            <dd className="mt-1 text-zinc-700">{settings.timezone}</dd>
          </div>
          <div>
            <dt className="font-medium">Online randevu durumu</dt>
            <dd className="mt-1 text-zinc-700">
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
            className="min-h-11 w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {busy ? "Kaydediliyor…" : "Ayarları kaydet"}
          </button>
        </div>
        ) : (
          <p className="text-xs text-zinc-500 sm:col-span-2">Salon ayarlarını yalnızca salon yöneticisi değiştirebilir.</p>
        )}

        <p
          id="tenant-settings-feedback"
          role="status"
          className={`text-sm sm:col-span-2 ${feedback?.kind === "error" ? "text-red-700" : "text-zinc-700"}`}
        >
          {feedback?.text}
        </p>
      </form>
    </section>
  );
}

"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { card, field, statusNote } from "../../_ui/styles";
import { createTenantAction } from "./actions";
import { Button } from "@/components/ui/button";

const labelClass = "block text-subhead font-medium text-ink";

/** `onCreated` (optional) lets a host sheet close and announce success itself. */
export function TenantProvisioningForm({ onCreated }: { onCreated?: (salonName: string) => void } = {}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setMessage("");
    setIsSubmitting(true);

    try {
      const form = new FormData(formElement);
      const result = await createTenantAction({
        name: String(form.get("name") ?? ""),
        slug: String(form.get("slug") ?? ""),
        timezone: String(form.get("timezone") ?? ""),
        firstAdminDisplayName: String(form.get("firstAdminDisplayName") ?? ""),
        firstAdminEmail: String(form.get("firstAdminEmail") ?? ""),
        firstAdminPassword: String(form.get("firstAdminPassword") ?? ""),
        firstAdminPhone: String(form.get("firstAdminPhone") ?? ""),
      });

      if (result.status === "created") {
        router.refresh();
        formElement.reset();
        if (onCreated) {
          onCreated(String(form.get("name") ?? "").trim());
        } else {
          setMessage("Salon ve ilk tenant admin hesabı oluşturuldu.");
        }
        return;
      }

      const messages: Record<string, string> = {
        UNAUTHORIZED: "Bu işlem için yetkiniz yok.",
        INVALID_INPUT: "Girilen bilgiler geçersiz.",
        DUPLICATE_SLUG: "Bu salon adresi zaten kullanılıyor.",
        AUTH_PROVISIONING_FAILED: "Tenant admin hesabı oluşturulamadı.",
        AUTH_BINDING_FAILED: "Tenant admin tenant'a bağlanamadı.",
        AUTH_BINDING_ROLLBACK_FAILED: "Güvenli geri alma başarısız oldu.",
        AUTH_COMPENSATION_FAILED: "Güvenli geri alma başarısız oldu.",
        PERSISTENCE_FAILURE: "Salon kaydedilemedi.",
        CONFIGURATION_ERROR: "Sunucu yapılandırması eksik.",
      };

      setMessage(messages[result.status] ?? "İşlem başarısız oldu.");
    } catch {
      setMessage("İşlem sırasında beklenmeyen bir hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset disabled={isSubmitting} className="min-w-0">
        <legend className="group-label">Salon bilgileri</legend>
        <div className={`${card} space-y-4`}>
          <div className="space-y-1.5">
            <label htmlFor="name" className={labelClass}>Salon adı</label>
            <input id="name" name="name" required className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="slug" className={labelClass}>Bağlantı adı</label>
            <input
              id="slug"
              name="slug"
              placeholder="salon-adi"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-describedby="slug-hint"
              className={field}
            />
            <p id="slug-hint" className="text-footnote text-ink-muted">
              Salonun web adresinde görünür: …/salon-adi. Küçük harf, rakam ve tire kullanın. Fiziksel adres, salon ayarlarındaki “Konum” bölümünden girilir.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="timezone" className={labelClass}>Saat dilimi</label>
            {/* MVP supports only Europe/Istanbul (see MVP_SUPPORTED_TIMEZONES); the server re-validates. */}
            <input
              id="timezone"
              name="timezone"
              defaultValue="Europe/Istanbul"
              readOnly
              required
              className={`${field} bg-surface-muted text-ink-muted`}
            />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={isSubmitting} className="min-w-0">
        <legend className="group-label">İlk tenant admin</legend>
        <div className={`${card} space-y-4`}>
          <div className="space-y-1.5">
            <label htmlFor="firstAdminDisplayName" className={labelClass}>Ad soyad</label>
            <input id="firstAdminDisplayName" name="firstAdminDisplayName" required className={field} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="firstAdminEmail" className={labelClass}>E-posta</label>
            <input
              id="firstAdminEmail"
              name="firstAdminEmail"
              type="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="firstAdminPassword" className={labelClass}>Şifre</label>
            <input
              id="firstAdminPassword"
              name="firstAdminPassword"
              type="password"
              minLength={8}
              aria-describedby="firstAdminPassword-hint"
              required
              className={field}
            />
            <p id="firstAdminPassword-hint" className="text-footnote text-ink-muted">En az 8 karakter.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="firstAdminPhone" className={labelClass}>Telefon (isteğe bağlı)</label>
            <input id="firstAdminPhone" name="firstAdminPhone" type="tel" className={`${field} tabular-nums`} />
          </div>
        </div>
      </fieldset>

      <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} variant="primary" className="w-full">
        {isSubmitting ? "Oluşturuluyor..." : "Salon oluştur"}
      </Button>

      {message !== "" ? <p role="status" className={statusNote}>{message}</p> : null}
    </form>
  );
}

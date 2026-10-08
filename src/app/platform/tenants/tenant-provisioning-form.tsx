"use client";

import { FormEvent, useState } from "react";
import { createTenantAction } from "./actions";

export function TenantProvisioningForm() {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    try {
      const form = new FormData(event.currentTarget);
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
        event.currentTarget.reset();
        setMessage("Salon ve ilk tenant admin hesabı oluşturuldu.");
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
    <form onSubmit={onSubmit}>
      <fieldset disabled={isSubmitting}>
        <legend>Salon bilgileri</legend>
        <label htmlFor="name">Salon adı</label>
        <input id="name" name="name" required />
        <label htmlFor="slug">Adres</label>
        <input id="slug" name="slug" placeholder="salon-adi" required />
        <label htmlFor="timezone">Saat dilimi</label>
        <input id="timezone" name="timezone" placeholder="Europe/Istanbul" required />
      </fieldset>

      <fieldset disabled={isSubmitting}>
        <legend>İlk tenant admin</legend>
        <label htmlFor="firstAdminDisplayName">Ad soyad</label>
        <input id="firstAdminDisplayName" name="firstAdminDisplayName" required />
        <label htmlFor="firstAdminEmail">E-posta</label>
        <input id="firstAdminEmail" name="firstAdminEmail" type="email" required />
        <label htmlFor="firstAdminPassword">Şifre</label>
        <input
          id="firstAdminPassword"
          name="firstAdminPassword"
          type="password"
          minLength={8}
          required
        />
        <label htmlFor="firstAdminPhone">Telefon</label>
        <input id="firstAdminPhone" name="firstAdminPhone" />
      </fieldset>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Oluşturuluyor..." : "Salon oluştur"}
      </button>

      {message !== "" ? <p role="status">{message}</p> : null}
    </form>
  );
}

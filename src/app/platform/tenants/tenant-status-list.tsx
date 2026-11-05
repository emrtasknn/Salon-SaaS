"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { badgeBase, buttonDestructiveOutline, buttonSecondary, statusNote } from "../../_ui/styles";
import { setTenantStatusAction } from "./actions";

type TenantRow = Readonly<{
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
}>;

const errorMessages: Record<string, string> = {
  INVALID_INPUT: "Geçersiz istek.",
  NOT_FOUND: "Salon bulunamadı. Liste yenilendi.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  PERSISTENCE_FAILURE: "Durum kaydedilemedi. Lütfen tekrar deneyin.",
};

export function TenantStatusList({ tenants }: { tenants: ReadonlyArray<TenantRow> }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState("");
  const [message, setMessage] = useState("");

  if (tenants.length === 0) {
    return <p className={statusNote}>Henüz salon yok. Aşağıdaki formdan ilk salonu oluşturun.</p>;
  }

  return (
    <>
      <p role="status" aria-live="polite" className={message !== "" ? statusNote : "sr-only"}>{message}</p>
      <ul className="inset-group">
        {tenants.map((tenant) => {
          const active = tenant.status === "ACTIVE";
          const next = active ? "INACTIVE" : "ACTIVE";
          const label = active ? "Pasife al" : "Aktifleştir";
          return (
            <li key={tenant.id} className="inset-row flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-headline text-ink">{tenant.name}</p>
                <p className="truncate text-subhead text-ink-muted">/{tenant.slug}</p>
              </div>
              <span
                className={`${badgeBase} ${active ? "bg-status-confirmed-bg text-status-confirmed" : "bg-status-cancelled-bg text-status-cancelled"}`}
              >
                {active ? "Aktif" : "Pasif"}
              </span>
              <form
                action={(formData) => {
                  setPendingId(tenant.id);
                  setMessage("");
                  startTransition(async () => {
                    try {
                      const result = await setTenantStatusAction(formData);
                      if (result.ok) {
                        setMessage(
                          next === "ACTIVE"
                            ? `${tenant.name} aktifleştirildi. Online randevu açık.`
                            : `${tenant.name} pasife alındı. Online ve yeni randevu alınmıyor.`,
                        );
                      } else {
                        setMessage(errorMessages[result.code] ?? "İşlem başarısız oldu.");
                      }
                      router.refresh();
                    } catch {
                      setMessage("İşlem sırasında beklenmeyen bir hata oluştu.");
                    } finally {
                      setPendingId("");
                    }
                  });
                }}
              >
                <input type="hidden" name="tenantId" value={tenant.id} />
                <input type="hidden" name="status" value={next} />
                <button
                  type="submit"
                  disabled={busy}
                  aria-label={`${tenant.name}: ${label}`}
                  className={active ? buttonDestructiveOutline : buttonSecondary}
                >
                  {pendingId === tenant.id ? "Kaydediliyor..." : label}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </>
  );
}

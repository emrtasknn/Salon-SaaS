"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
    return <p>Henüz salon yok. Aşağıdaki formdan ilk salonu oluşturun.</p>;
  }

  return (
    <>
      <p role="status">{message}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Salon</th>
            <th scope="col">Adres</th>
            <th scope="col">Durum</th>
            <th scope="col">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant) => {
            const next = tenant.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
            const label = tenant.status === "ACTIVE" ? "Pasife al" : "Aktifleştir";
            return (
              <tr key={tenant.id}>
                <td>{tenant.name}</td>
                <td>/{tenant.slug}</td>
                <td>{tenant.status === "ACTIVE" ? "Aktif" : "Pasif"}</td>
                <td>
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
                    <button type="submit" disabled={busy} aria-label={`${tenant.name}: ${label}`}>
                      {pendingId === tenant.id ? "Kaydediliyor..." : label}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

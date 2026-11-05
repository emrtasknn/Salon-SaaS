"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { card, switchClassName } from "../_ui/styles";
import { setAdminServesAsStaffAction } from "./actions";

// Owner decision 2026-11-05. Ready to mount on the admin page after the admin restructure lands:
//   <ServesAsStaffToggle initialEnabled={data.adminServesAsStaff} />
// The action takes no ids; it only ever changes the signed-in admin's own staff row.

const errorMessages: Record<string, string> = {
  UNAUTHORIZED: "Bu işlem için yetkiniz yok.",
  INVALID_INPUT: "Geçersiz istek.",
  PERSISTENCE_FAILURE: "Kaydedilemedi. Lütfen tekrar deneyin.",
};

export function ServesAsStaffToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setAdminServesAsStaffAction(next);
      if (result.status === "ok") {
        setEnabled(result.servesAsStaff);
        router.refresh();
        return;
      }
      setError(errorMessages[result.status] ?? errorMessages.PERSISTENCE_FAILURE);
    });
  }

  return (
    <section aria-labelledby="serves-as-staff-title" className={card}>
      <label className="flex items-start justify-between gap-4">
        <span>
          <span id="serves-as-staff-title" className="block font-semibold text-ink">Ben de hizmet veriyorum</span>
          <span className="block text-subhead text-ink-muted">
            Açıkken müşteriler online randevuda sizi de seçebilir ve kendi randevularınızı personel ekranında görürsünüz.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={enabled}
          checked={enabled}
          disabled={busy}
          onChange={(event) => toggle(event.target.checked)}
          className={switchClassName}
        />
      </label>
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
    </section>
  );
}

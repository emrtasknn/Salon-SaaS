"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerCancelResult } from "../../../../application/customer-appointment-status";
import { cancelAppointmentByToken } from "./actions";
import { statusNote } from "../../../_ui/styles";
import { Button } from "@/components/ui/button";

const resultMessages: Record<CustomerCancelResult["status"], string> = {
  CANCELLED: "Randevunuz iptal edildi.",
  ALREADY_CANCELLED: "Bu randevu zaten iptal edilmiş.",
  CUTOFF_PASSED: "Online iptal süresi doldu. Randevudan 2 saat önce iptal kapanır; lütfen salonla iletişime geçin.",
  NOT_CANCELLABLE: "Bu randevu artık iptal edilemez.",
  NOT_FOUND: "Bu bağlantı geçersiz veya süresi dolmuş.",
  RATE_LIMITED: "Çok fazla deneme, lütfen biraz sonra tekrar deneyin.",
};

export function CancelForm({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();

  function cancel() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await cancelAppointmentByToken(slug, token);
        setMessage(resultMessages[result.status]);
        setConfirming(false);
        if (result.status === "CANCELLED" || result.status === "ALREADY_CANCELLED") {
          router.refresh();
        }
      } catch {
        setMessage("Randevu iptal edilemedi. Lütfen daha sonra tekrar deneyin.");
      }
    });
  }

  return (
    <div className="space-y-3">
      {!confirming ? (
        <Button
          type="button"
          onClick={() => {
            setMessage("");
            setConfirming(true);
          }}
          variant="danger-outline" className="w-full"
        >
          Randevuyu iptal et
        </Button>
      ) : (
        <div role="group" aria-labelledby="cancel-confirm-title" className="space-y-3 rounded-card bg-status-rejected-bg p-4">
          <p id="cancel-confirm-title" className="text-subhead font-medium text-status-rejected">
            Randevuyu iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              disabled={busy}
              onClick={cancel}
              variant="danger" className="flex-1"
            >
              {busy ? "İptal ediliyor…" : "Evet, iptal et"}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              variant="secondary" className="flex-1"
            >
              Vazgeç
            </Button>
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" className={message ? statusNote : "sr-only"}>
        {message}
      </p>
    </div>
  );
}

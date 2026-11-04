"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerCancelResult } from "../../../../application/customer-appointment-status";
import { cancelAppointmentByToken } from "./actions";

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
        <button
          type="button"
          onClick={() => {
            setMessage("");
            setConfirming(true);
          }}
          className="min-h-11 w-full rounded-lg border border-red-300 px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          Randevuyu iptal et
        </button>
      ) : (
        <div role="group" aria-labelledby="cancel-confirm-title" className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <p id="cancel-confirm-title" className="text-sm font-medium text-red-900">
            Randevuyu iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="min-h-11 flex-1 rounded-lg bg-red-700 px-4 py-3 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              {busy ? "İptal ediliyor…" : "Evet, iptal et"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="min-h-11 flex-1 rounded-lg border bg-white px-4 py-3 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" className={message ? "rounded-lg border p-3 text-sm" : "sr-only"}>
        {message}
      </p>
    </div>
  );
}

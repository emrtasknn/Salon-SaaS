"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StopWhatsAppResult } from "../../../legal-consent-contract";
import { stopWhatsAppByToken } from "./actions";

const resultMessages: Record<StopWhatsAppResult["status"], string> = {
  stopped: "WhatsApp bildirimleri durduruldu. Bu randevu için WhatsApp mesajı gönderilmeyecek.",
  already_stopped: "WhatsApp bildirimleri zaten kapalı.",
  not_opted_in: "Bu randevu için WhatsApp bildirimi izni yok.",
  not_found: "Bu bağlantı geçersiz veya süresi dolmuş.",
  rate_limited: "Çok fazla deneme, lütfen biraz sonra tekrar deneyin.",
};

/** WP-10: withdraw the WhatsApp opt-in recorded for this booking (status-link token is the only credential). */
export function WhatsAppOptOutForm({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();

  function stop() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await stopWhatsAppByToken(slug, token);
        setMessage(resultMessages[result.status] ?? "İşlem tamamlanamadı. Lütfen daha sonra tekrar deneyin.");
        setConfirming(false);
        if (result.status === "stopped" || result.status === "already_stopped" || result.status === "not_opted_in") {
          router.refresh();
        }
      } catch {
        setMessage("WhatsApp bildirimleri durdurulamadı. Lütfen daha sonra tekrar deneyin.");
      }
    });
  }

  const focusRing =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

  return (
    <div className="space-y-3">
      {!confirming ? (
        <button
          type="button"
          onClick={() => {
            setMessage("");
            setConfirming(true);
          }}
          className={`min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50 ${focusRing}`}
        >
          WhatsApp bildirimlerini durdur
        </button>
      ) : (
        <div role="group" aria-labelledby="whatsapp-stop-confirm-title" className="space-y-3 rounded-lg border border-zinc-300 bg-zinc-50 p-4">
          <p id="whatsapp-stop-confirm-title" className="text-sm font-medium text-zinc-900">
            Bu randevuyla ilgili WhatsApp bildirimlerini durdurmak istiyor musunuz? Randevunuz iptal edilmez.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={stop}
              className={`min-h-11 flex-1 rounded-lg bg-black px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            >
              {busy ? "Durduruluyor…" : "Evet, durdur"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className={`min-h-11 flex-1 rounded-lg border bg-white px-4 py-3 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
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

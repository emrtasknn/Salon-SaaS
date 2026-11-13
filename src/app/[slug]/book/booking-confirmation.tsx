"use client";

import { useEffect, useRef, useState } from "react";
import { card } from "../../_ui/styles";
import { Button } from "@/components/ui/button";
import { SuccessMark } from "@/components/ui/success-mark";

export type BookingSummary = Readonly<{
  serviceName: string;
  staffName: string;
  startAtIso: string;
  timeZone: string;
  statusUrl: string;
}>;

function formatWhen(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Shown in place of the form once a booking request is created, so the result is the first thing the customer sees. */
export function BookingConfirmation({ summary, onNewBooking }: { summary: BookingSummary; onNewBooking: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="booking-done-title" className="space-y-5">
      <header>
        <SuccessMark className="mb-4" />
        <h1 id="booking-done-title" ref={headingRef} tabIndex={-1} className="text-large-title outline-none">
          Randevu talebiniz alındı
        </h1>
        <p className="measure mt-2 text-body text-ink-muted">
          İşletme talebinizi onayladığında size haber verilecek.
        </p>
      </header>

      <dl className={`${card} space-y-3`}>
        <div>
          <dt className="text-footnote text-ink-muted">Hizmet</dt>
          <dd className="text-body font-medium">{summary.serviceName}</dd>
        </div>
        <div>
          <dt className="text-footnote text-ink-muted">Personel</dt>
          <dd className="text-body font-medium">{summary.staffName}</dd>
        </div>
        <div>
          <dt className="text-footnote text-ink-muted">Tarih ve saat</dt>
          <dd className="text-body font-medium tabular-nums">{formatWhen(summary.startAtIso, summary.timeZone)}</dd>
        </div>
      </dl>

      {summary.statusUrl && (
        <div className={`${card} space-y-3`}>
          <h2 className="text-headline">Randevu bağlantınız</h2>
          <p className="text-subhead text-ink-muted">
            Bu bağlantıyı kaydedin; randevunuzu görmek veya iptal etmek için kullanabilirsiniz.
          </p>
          <a href={summary.statusUrl} className="focus-ring block break-all rounded-control bg-surface-muted p-3 text-subhead text-ink underline">
            {summary.statusUrl}
          </a>
          <Button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(summary.statusUrl);
                setCopyState("copied");
              } catch {
                setCopyState("failed");
              }
            }}
            variant="secondary"
            className="w-full sm:w-auto"
          >
            Bağlantıyı kopyala
          </Button>
          <p aria-live="polite" className="text-footnote text-ink-muted">
            {copyState === "copied" && "Bağlantı kopyalandı."}
            {copyState === "failed" && "Kopyalanamadı. Bağlantıyı seçip elle kopyalayın."}
          </p>
        </div>
      )}

      <Button type="button" onClick={onNewBooking} variant="secondary" className="w-full">
        Yeni randevu al
      </Button>
    </section>
  );
}

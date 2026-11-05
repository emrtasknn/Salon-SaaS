export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { AppointmentStatus } from "../../../../domain/appointment";
import type { CustomerAppointmentView } from "../../../../application/customer-appointment-status";
import { loadCustomerAppointment } from "./data";
import { CancelForm } from "./cancel-form";
import { WhatsAppOptOutForm } from "./whatsapp-optout-form";
import type { CustomerWhatsAppState } from "../../../legal-consent-contract";
import { appointmentStatusBadge, badgeBase } from "../../../_ui/styles";
import { BackLink } from "../../../_ui/back-link";

export const metadata: Metadata = {
  title: "Randevu durumu",
  robots: { index: false, follow: false },
};

const statusLabels: Record<AppointmentStatus, string> = {
  PENDING: "Beklemede",
  CONFIRMED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal edildi",
  COMPLETED: "Tamamlandı",
};

const statusHints: Record<AppointmentStatus, string> = {
  PENDING: "Talebiniz salon tarafından henüz onaylanmadı.",
  CONFIRMED: "Randevunuz onaylandı.",
  REJECTED: "Salon bu randevu talebini kabul etmedi.",
  CANCELLED: "Bu randevu iptal edildi.",
  COMPLETED: "Bu randevu tamamlandı.",
};

function formatDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function Shell({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-xl px-4 pb-10 pt-4 sm:px-6">
        <BackLink href={`/${encodeURIComponent(slug)}`} label="Salon sayfası" className="mb-3" />
        {children}
      </div>
    </main>
  );
}

function Unavailable({ slug, message }: { slug: string; message: string }) {
  return (
    <Shell slug={slug}>
      <section className="space-y-3">
        <h1 className="text-large-title">Randevu durumu</h1>
        <p role="status" className="inset-group p-4 text-body text-ink-muted">{message}</p>
      </section>
    </Shell>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inset-row flex min-h-12 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3">
      <dt className="text-subhead text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right text-body font-medium text-ink">{children}</dd>
    </div>
  );
}

function AppointmentDetails({
  slug,
  token,
  appointment,
  whatsapp,
}: {
  slug: string;
  token: string;
  appointment: CustomerAppointmentView;
  whatsapp: CustomerWhatsAppState;
}) {
  const { timeZone, status } = appointment;
  const isOpen = status === "PENDING" || status === "CONFIRMED";

  return (
    <Shell slug={slug}>
      <div className="space-y-7">
        <header>
          <p className="text-subhead font-medium text-ink-muted">{appointment.salonName}</p>
          <h1 className="mt-1 text-large-title">Randevu durumu</h1>
        </header>

        <div className="inset-group space-y-2 p-4">
          <span className={`${badgeBase} ${appointmentStatusBadge[status]}`}>
            Durum: {statusLabels[status]}
          </span>
          <p className="text-body text-ink-muted">{statusHints[status]}</p>
        </div>

        <dl className="inset-group">
          <DetailRow label="Hizmet">{appointment.serviceName}</DetailRow>
          <DetailRow label="Personel">{appointment.staffName}</DetailRow>
          <DetailRow label="Tarih">{formatDate(appointment.startAtIso, timeZone)}</DetailRow>
          <DetailRow label="Saat">
            <span className="tabular-nums">
              {formatTime(appointment.startAtIso, timeZone)} – {formatTime(appointment.endAtIso, timeZone)}
            </span>
          </DetailRow>
        </dl>

        {isOpen && appointment.canCancel && (
          <div className="space-y-2">
            <p className="px-4 text-footnote tabular-nums text-ink-muted">
              Online iptal {formatDate(appointment.cancelDeadlineIso, timeZone)}{" "}
              {formatTime(appointment.cancelDeadlineIso, timeZone)} saatine kadar açıktır.
            </p>
            <CancelForm slug={slug} token={token} />
          </div>
        )}

        {isOpen && !appointment.canCancel && (
          <p className="px-4 text-subhead text-ink-muted">
            Online iptal, randevudan 2 saat önce kapanır. Değişiklik için lütfen salonla iletişime geçin.
          </p>
        )}

        {whatsapp === "OPTED_IN" && (
          <section aria-labelledby="whatsapp-title" className="inset-group space-y-2 p-4">
            <h2 id="whatsapp-title" className="text-headline">WhatsApp bildirimleri</h2>
            <p className="text-subhead text-ink-muted">Bu randevuyla ilgili bilgilendirmeler WhatsApp üzerinden gönderiliyor.</p>
            <WhatsAppOptOutForm slug={slug} token={token} />
          </section>
        )}

        {whatsapp === "OPTED_OUT" && (
          <p role="status" className="px-4 text-subhead text-ink-muted">
            WhatsApp bildirimleri kapalı.
          </p>
        )}
      </div>
    </Shell>
  );
}

export default async function CustomerAppointmentStatusPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const result = await loadCustomerAppointment(slug, token);

  if (result.status === "ok") {
    return <AppointmentDetails slug={slug} token={token} appointment={result.appointment} whatsapp={result.whatsapp} />;
  }
  if (result.status === "RATE_LIMITED") {
    return <Unavailable slug={slug} message="Çok fazla deneme, lütfen biraz sonra tekrar deneyin." />;
  }
  return <Unavailable slug={slug} message="Bu bağlantı geçersiz veya süresi dolmuş." />;
}

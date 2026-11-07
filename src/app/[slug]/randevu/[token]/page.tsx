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
import { buildGoogleCalendarUrl, type CalendarEvent } from "../../../../domain/calendar-event";
import { customerCalendarEvent } from "./calendar";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { SalonLocationLink } from "../../../_ui/salon-location-link";
import { ButtonAnchor } from "@/components/ui/button";

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
        <Breadcrumb className="mb-3" items={[{ label: "Salon sayfası", href: `/${encodeURIComponent(slug)}` }, { label: "Randevum" }]} />
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

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
      <path d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5" />
    </svg>
  );
}

function AddToCalendar({
  slug,
  token,
  event,
  pending,
}: {
  slug: string;
  token: string;
  event: CalendarEvent;
  pending: boolean;
}) {
  const icsHref = `/${encodeURIComponent(slug)}/randevu/${encodeURIComponent(token)}/takvim.ics`;
  return (
    <section aria-labelledby="calendar-title" className="space-y-2">
      <h2 id="calendar-title" className="group-label">Takvime ekle</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ButtonAnchor href={icsHref} download="randevu.ics" rel="nofollow" variant="secondary" className="w-full">
          <CalendarIcon />
          Apple Takvim
        </ButtonAnchor>
        <ButtonAnchor
          href={buildGoogleCalendarUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          variant="secondary" className="w-full"
        >
          <CalendarIcon />
          Google Takvim
        </ButtonAnchor>
      </div>
      {pending && (
        <p className="px-4 text-footnote text-ink-muted">
          Randevunuz henüz onaylanmadı; onay durumunu bu sayfadan takip edin.
        </p>
      )}
    </section>
  );
}

function AppointmentDetails({
  slug,
  token,
  appointment,
  whatsapp,
  calendarEvent,
}: {
  slug: string;
  token: string;
  appointment: CustomerAppointmentView;
  whatsapp: CustomerWhatsAppState;
  calendarEvent: CalendarEvent | null;
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

        {appointment.location && (
          <section aria-labelledby="location-title" className="space-y-2">
            <h2 id="location-title" className="group-label">Konum</h2>
            <div className="inset-group px-4 py-1">
              <SalonLocationLink location={appointment.location} />
            </div>
          </section>
        )}

        {calendarEvent && (
          <AddToCalendar slug={slug} token={token} event={calendarEvent} pending={status === "PENDING"} />
        )}

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
            <h2 id="whatsapp-title" className="text-headline">SMS ve WhatsApp bildirimleri</h2>
            <p className="text-subhead text-ink-muted">Bu randevuyla ilgili bilgilendirmeler SMS veya WhatsApp üzerinden gönderiliyor.</p>
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
    const calendarEvent = await customerCalendarEvent(slug, token, result.appointment);
    return (
      <AppointmentDetails
        slug={slug}
        token={token}
        appointment={result.appointment}
        whatsapp={result.whatsapp}
        calendarEvent={calendarEvent}
      />
    );
  }
  if (result.status === "RATE_LIMITED") {
    return <Unavailable slug={slug} message="Çok fazla deneme, lütfen biraz sonra tekrar deneyin." />;
  }
  return <Unavailable slug={slug} message="Bu bağlantı geçersiz veya süresi dolmuş." />;
}

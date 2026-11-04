export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { AppointmentStatus } from "../../../../domain/appointment";
import type { CustomerAppointmentView } from "../../../../application/customer-appointment-status";
import { loadCustomerAppointment } from "./data";
import { CancelForm } from "./cancel-form";

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

const statusBadgeClass: Record<AppointmentStatus, string> = {
  PENDING: "border-amber-300 bg-amber-50 text-amber-900",
  CONFIRMED: "border-emerald-300 bg-emerald-50 text-emerald-900",
  REJECTED: "border-red-300 bg-red-50 text-red-900",
  CANCELLED: "border-zinc-300 bg-zinc-100 text-zinc-800",
  COMPLETED: "border-sky-300 bg-sky-50 text-sky-900",
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

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-xl p-4 sm:p-8">{children}</div>
    </main>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <Shell>
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Randevu durumu</h1>
        <p role="status" className="mt-3 text-sm text-zinc-600">{message}</p>
      </section>
    </Shell>
  );
}

function AppointmentDetails({
  slug,
  token,
  appointment,
}: {
  slug: string;
  token: string;
  appointment: CustomerAppointmentView;
}) {
  const { timeZone, status } = appointment;
  const isOpen = status === "PENDING" || status === "CONFIRMED";

  return (
    <Shell>
      <section className="space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
        <header>
          <p className="text-sm text-zinc-500">{appointment.salonName}</p>
          <h1 className="mt-1 text-2xl font-semibold">Randevu durumu</h1>
        </header>

        <div className="space-y-1">
          <span
            className={`inline-block rounded-full border px-3 py-1 text-sm font-medium ${statusBadgeClass[status]}`}
          >
            Durum: {statusLabels[status]}
          </span>
          <p className="text-sm text-zinc-600">{statusHints[status]}</p>
        </div>

        <dl className="grid grid-cols-1 gap-3 border-t pt-5 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-zinc-500">Hizmet</dt>
          <dd className="font-medium">{appointment.serviceName}</dd>
          <dt className="text-zinc-500">Personel</dt>
          <dd className="font-medium">{appointment.staffName}</dd>
          <dt className="text-zinc-500">Tarih</dt>
          <dd className="font-medium">{formatDate(appointment.startAtIso, timeZone)}</dd>
          <dt className="text-zinc-500">Saat</dt>
          <dd className="font-medium">
            {formatTime(appointment.startAtIso, timeZone)} – {formatTime(appointment.endAtIso, timeZone)}
          </dd>
        </dl>

        {isOpen && appointment.canCancel && (
          <div className="space-y-2 border-t pt-5">
            <p className="text-xs text-zinc-500">
              Online iptal {formatDate(appointment.cancelDeadlineIso, timeZone)}{" "}
              {formatTime(appointment.cancelDeadlineIso, timeZone)} saatine kadar açıktır.
            </p>
            <CancelForm slug={slug} token={token} />
          </div>
        )}

        {isOpen && !appointment.canCancel && (
          <p className="border-t pt-5 text-sm text-zinc-600">
            Online iptal, randevudan 2 saat önce kapanır. Değişiklik için lütfen salonla iletişime geçin.
          </p>
        )}
      </section>
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
    return <AppointmentDetails slug={slug} token={token} appointment={result.appointment} />;
  }
  if (result.status === "RATE_LIMITED") {
    return <Unavailable message="Çok fazla deneme, lütfen biraz sonra tekrar deneyin." />;
  }
  return <Unavailable message="Bu bağlantı geçersiz veya süresi dolmuş." />;
}

export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { loadPublicLegalView } from "../legal-data";
import { PublicBookingForm } from "./form";
import { buttonSecondary } from "../../_ui/styles";

function todayInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ service?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const prisma = getPrisma();
  const [vitrin, legal] = await Promise.all([
    createPublicVitrin(createPrismaPublicSalonRepository(prisma)).load(slug),
    loadPublicLegalView(slug),
  ]);
  if (vitrin.status !== "ok") notFound();

  if (!vitrin.active) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto max-w-xl px-4 pb-10 pt-8 sm:px-6">
          <section className="inset-group space-y-4 p-6">
            <h1 className="text-title">{vitrin.name}</h1>
            <p role="status" className="rounded-card bg-status-pending-bg p-4 text-subhead text-status-pending">
              Şu anda online randevu alınmıyor.
            </p>
            {vitrin.whatsAppUrl && (
              <a
                href={vitrin.whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonSecondary}
              >
                WhatsApp&apos;tan yaz
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </a>
            )}
          </section>
        </div>
      </main>
    );
  }

  // WP-10: the form stays closed until the salon's legal fields (KVKK notice data) are complete.
  // The server re-checks this inside the booking transaction (TENANT_LEGAL_INCOMPLETE).
  if (!legal || !legal.ready) {
    return (
      <main className="min-h-screen bg-canvas">
        <div className="mx-auto max-w-xl px-4 pb-10 pt-8 sm:px-6">
          <section className="inset-group space-y-4 p-6">
            <h1 className="text-title">{vitrin.name}</h1>
            <p role="status" className="rounded-card bg-status-pending-bg p-4 text-subhead text-status-pending">
              Bu salon online randevu için henüz hazır değil. Randevu için lütfen salonla doğrudan iletişime geçin.
            </p>
            {vitrin.whatsAppUrl && (
              <a
                href={vitrin.whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonSecondary}
              >
                WhatsApp&apos;tan yaz
                <span className="sr-only"> (yeni sekmede açılır)</span>
              </a>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <PublicBookingForm
      slug={slug}
      legal={legal}
      services={vitrin.services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
      }))}
      staff={vitrin.staff.map((member) => ({
        id: member.id,
        displayName: member.displayName,
      }))}
      timeZone={vitrin.timezone}
      minDate={todayInTimeZone(vitrin.timezone)}
      initialServiceId={query.service && vitrin.services.some((service) => service.id === query.service) ? query.service : ""}
    />
  );
}

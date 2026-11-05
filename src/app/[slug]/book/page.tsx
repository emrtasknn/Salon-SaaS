export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { loadPublicLegalView } from "../legal-data";
import { PublicBookingForm } from "./form";

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
      <main className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-xl p-4 sm:p-8">
          <section className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold">{vitrin.name}</h1>
            <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Şu anda online randevu alınmıyor.
            </p>
            {vitrin.whatsAppUrl && (
              <a
                href={vitrin.whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
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
      <main className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-xl p-4 sm:p-8">
          <section className="space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold">{vitrin.name}</h1>
            <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Bu salon online randevu için henüz hazır değil. Randevu için lütfen salonla doğrudan iletişime geçin.
            </p>
            {vitrin.whatsAppUrl && (
              <a
                href={vitrin.whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
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

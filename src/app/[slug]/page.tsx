export const dynamic = "force-dynamic";

import { createPublicVitrin } from "../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import Link from "next/link";
import { AppBar } from "../_ui/app-bar";
import { SalonLocationLink } from "../_ui/salon-location-link";
import { ButtonAnchor } from "@/components/ui/button";

function WhatsAppLink({ href }: { href: string }) {
  return (
    <ButtonAnchor href={href} target="_blank" rel="noopener noreferrer" variant="secondary">
      WhatsApp&apos;tan yaz
      <span className="sr-only"> (yeni sekmede açılır)</span>
    </ButtonAnchor>
  );
}

function Brand() {
  return <p className="text-footnote font-semibold text-ink-muted">RandevuN</p>;
}

export default async function PublicSalonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await createPublicVitrin(createPrismaPublicSalonRepository(getPrisma())).load(slug);
  if (result.status !== "ok") {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="text-title">{result.status === "NOT_FOUND" ? "İşletme bulunamadı" : "İşletme yüklenemedi"}</h1>
      </main>
    );
  }

  if (!result.active) {
    return (
      <main className="min-h-screen bg-canvas">
        <AppBar>
          <Brand />
        </AppBar>
        <div className="mx-auto max-w-xl px-4 pb-10 pt-6 sm:px-6">
          <header className="space-y-4">
            <h1 className="text-large-title">{result.name}</h1>
            {result.location && <SalonLocationLink location={result.location} />}
            <p role="status" className="rounded-card bg-status-pending-bg p-4 text-subhead text-status-pending">
              Şu anda online randevu alınmıyor.
            </p>
            {result.whatsAppUrl && <WhatsAppLink href={result.whatsAppUrl} />}
          </header>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas">
      <AppBar>
        <Brand />
        {result.whatsAppUrl && <WhatsAppLink href={result.whatsAppUrl} />}
      </AppBar>
      <div className="mx-auto max-w-xl px-4 pb-10 pt-6 sm:px-6">
        <header>
          <h1 className="text-large-title">{result.name}</h1>
          {result.location && <SalonLocationLink location={result.location} className="mt-1" />}
          <p className="measure mt-2 text-body text-ink-muted">Randevu almak için bir hizmet seçin.</p>
        </header>
        <section aria-labelledby="services-title" className="mt-8">
          <h2 id="services-title" className="group-label">Hizmetler</h2>
          <ul className="inset-group">
            {result.services.map((s) => (
              <li key={s.id} className="inset-row">
                <Link
                  href={`/${slug}/book?service=${encodeURIComponent(s.id)}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-surface-muted focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus active:bg-separator"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-medium text-ink">{s.name}</span>
                    <span className="mt-0.5 block text-footnote tabular-nums text-ink-muted">{s.durationMinutes} dk</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-action px-3.5 py-1.5 text-footnote font-semibold text-on-action">
                    Randevu al
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

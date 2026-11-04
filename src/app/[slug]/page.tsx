export const dynamic = "force-dynamic";

import { createPublicVitrin } from "../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import Link from "next/link";

function WhatsAppLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
    >
      WhatsApp&apos;tan yaz
      <span className="sr-only"> (yeni sekmede açılır)</span>
    </a>
  );
}

export default async function PublicSalonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await createPublicVitrin(createPrismaPublicSalonRepository(getPrisma())).load(slug);
  if (result.status !== "ok") return <main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-semibold">{result.status === "NOT_FOUND" ? "İşletme bulunamadı" : "İşletme yüklenemedi"}</h1></main>;

  if (!result.active) {
    return (
      <main className="min-h-screen bg-zinc-50">
        <div className="mx-auto max-w-5xl p-4 sm:p-8">
          <header className="rounded-2xl border bg-white p-6">
            <p className="text-sm text-zinc-500">Salon-SaaS</p>
            <h1 className="mt-1 text-3xl font-semibold">{result.name}</h1>
            <p role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Şu anda online randevu alınmıyor.
            </p>
            {result.whatsAppUrl && <WhatsAppLink href={result.whatsAppUrl} />}
          </header>
        </div>
      </main>
    );
  }

  return <main className="min-h-screen bg-zinc-50"><div className="mx-auto max-w-5xl p-4 sm:p-8"><header className="rounded-2xl border bg-white p-6"><p className="text-sm text-zinc-500">Salon-SaaS</p><h1 className="mt-1 text-3xl font-semibold">{result.name}</h1><p className="mt-2 text-sm text-zinc-600">Randevu almak için bir hizmet seçin.</p>{result.whatsAppUrl && <WhatsAppLink href={result.whatsAppUrl} />}</header><section className="mt-6 rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Hizmetler</h2><div className="mt-4 space-y-3">{result.services.map(s => <div key={s.id} className="rounded-xl border p-4"><p className="font-medium">{s.name}</p><p className="mt-1 text-sm text-zinc-500">{s.durationMinutes} dk</p><Link href={`/${slug}/book?service=${encodeURIComponent(s.id)}`} className="mt-3 inline-block rounded-lg bg-black px-3 py-2 text-xs font-medium text-white">Randevu al</Link></div>)}</div></section></div></main>;
}

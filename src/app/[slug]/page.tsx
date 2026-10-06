export const dynamic = "force-dynamic";

import { createPublicVitrin } from "../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import Link from "next/link";

export default async function PublicSalonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await createPublicVitrin(createPrismaPublicSalonRepository(getPrisma())).load(slug);
  if (result.status !== "ok") return <main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-semibold">{result.status === "NOT_FOUND" ? "İşletme bulunamadı" : "İşletme yüklenemedi"}</h1></main>;
  return <main className="min-h-screen bg-zinc-50"><div className="mx-auto max-w-5xl p-4 sm:p-8"><header className="rounded-2xl border bg-white p-6"><p className="text-sm text-zinc-500">Salon-SaaS</p><h1 className="mt-1 text-3xl font-semibold">{result.name}</h1><p className="mt-2 text-sm text-zinc-600">Randevu almak için bir hizmet seçin.</p></header><section className="mt-6 rounded-2xl border bg-white p-5"><h2 className="text-lg font-semibold">Hizmetler</h2><div className="mt-4 space-y-3">{result.services.map(s => <div key={s.id} className="rounded-xl border p-4"><p className="font-medium">{s.name}</p><p className="mt-1 text-sm text-zinc-500">{s.durationMinutes} dk</p><Link href={`/${slug}/book?service=${encodeURIComponent(s.id)}`} className="mt-3 inline-block rounded-lg bg-black px-3 py-2 text-xs font-medium text-white">Randevu al</Link></div>)}</div></section></div></main>;
}

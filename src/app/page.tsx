import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-50">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium text-zinc-500">Salon-SaaS MVP</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight">İşletmenizin günlük operasyonunu tek yerden yönetin.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-zinc-600">
          Personel, hizmetler ve çalışma saatleriyle başlayın. Randevu akışı W10.3&apos;te bu yönetim alanına bağlanacak.
        </p>
        <div className="mt-8">
          <Link href="/admin" className="inline-flex rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white">Yönetim alanı</Link>
        </div>
      </section>
    </main>
  );
}

export const dynamic = "force-dynamic";

import Link from "next/link";
import { getCustomer, getCustomers } from "./actions";

export default async function CustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; q?: string }>;
}) {
  const query = await searchParams;

  if (query.id) {
    const result = await getCustomer(query.id);
    if (result.status !== "ok") {
      return (
        <main className="p-6">
          <h1 className="text-2xl font-semibold">
            {result.status === "UNAUTHORIZED" ? "Yetkisiz erişim" : "Müşteri bulunamadı"}
          </h1>
          <Link href="/admin/customers" className="mt-4 inline-block text-sm underline">
            Müşteri listesine dön
          </Link>
        </main>
      );
    }

    return (
      <main className="min-h-screen bg-zinc-50 p-4 sm:p-8">
        <div className="mx-auto max-w-4xl">
          <Link href="/admin/customers" className="text-sm underline">← Müşteriler</Link>
          <h1 className="mt-4 text-3xl font-semibold">{result.customer.displayName}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {result.customer.email ?? "E-posta yok"} · {result.customer.phone ?? "Telefon yok"}
          </p>

          <section className="mt-6 rounded-xl border bg-white p-5">
            <h2 className="font-semibold">Randevu geçmişi</h2>
            {result.customer.appointments.length ? (
              <div className="mt-4 space-y-2">
                {result.customer.appointments.map((appointment) => (
                  <div key={appointment.id} className="flex justify-between rounded-lg border p-3 text-sm">
                    <span>{new Date(appointment.startAt).toLocaleString("tr-TR")}</span>
                    <span>{appointment.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">Henüz randevu geçmişi yok.</p>
            )}
          </section>

          <section className="mt-6 rounded-xl border bg-white p-5">
            <h2 className="font-semibold">Notlar</h2>
            {result.customer.notes.length ? (
              <div className="mt-4 space-y-2">
                {result.customer.notes.map((note) => (
                  <p key={note.id} className="rounded-lg border p-3 text-sm">{note.body}</p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">Henüz not yok.</p>
            )}
          </section>
        </div>
      </main>
    );
  }

  const result = await getCustomers(query.q ?? "");
  if (result.status !== "ok") {
    return <main className="p-6"><h1 className="text-2xl font-semibold">Müşteriler yüklenemedi</h1></main>;
  }

  return (
    <main className="min-h-screen bg-zinc-50 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Müşteriler</h1>
            <p className="mt-1 text-sm text-zinc-500">Müşteri kayıtları, geçmiş ve notlar.</p>
          </div>
        </div>

        <form method="get" className="mt-6 flex gap-2">
          <label className="sr-only" htmlFor="customer-search">Müşteri ara</label>
          <input
            id="customer-search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Ad, e-posta veya telefon ara"
            className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm text-white">Ara</button>
        </form>

        <section className="mt-6 overflow-hidden rounded-xl border bg-white">
          {result.customers.length ? (
            <div className="divide-y">
              {result.customers.map((customer) => (
                <Link
                  key={customer.id}
                  href={`/admin/customers?id=${encodeURIComponent(customer.id)}`}
                  className="block p-4 hover:bg-zinc-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{customer.displayName}</div>
                      <div className="mt-1 text-sm text-zinc-500">
                        {customer.email ?? "E-posta yok"} · {customer.phone ?? "Telefon yok"}
                      </div>
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      <div>{customer.appointmentCount} randevu</div>
                      <div>{customer.lastAppointmentAt ? new Date(customer.lastAppointmentAt).toLocaleDateString("tr-TR") : "Henüz randevu yok"}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-zinc-500">
              {query.q ? "Aramanızla eşleşen müşteri bulunamadı." : "Henüz müşteri kaydı bulunmuyor."}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

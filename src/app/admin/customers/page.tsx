export const dynamic = "force-dynamic";

import Link from "next/link";
import { House, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "../../_ui/page-header";
import { getCustomer, getCustomers } from "./actions";
import { appointmentStatusBadge, appointmentStatusLabel, badgeBase, field } from "../../_ui/styles";
import { formatAppointmentDateTime } from "../../_ui/date-format";
import { CustomerList, customerContact } from "./customer-list";
import { CustomerNoteForm } from "./note-form";

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
        <main className="min-h-screen bg-canvas p-6">
          <h1 className="text-title text-ink">
            {result.status === "UNAUTHORIZED" ? "Yetkisiz erişim" : "Müşteri bulunamadı"}
          </h1>
          <Link href="/admin/customers" className="focus-ring mt-4 inline-block text-subhead text-ink underline">
            Müşteri listesine dön
          </Link>
        </main>
      );
    }

    const contact = [customerContact({ phone: result.customer.phone, email: null }), result.customer.email].filter(Boolean);

    return (
      <main className="min-h-screen bg-canvas">
        <PageHeader
          title={result.customer.displayName}
          breadcrumb={[{ label: "Yönetim", href: "/admin", icon: House }, { label: "Müşteriler", href: "/admin/customers" }, { label: result.customer.displayName }]}
          widthClassName="max-w-4xl"
        />
        <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-8">
          {contact.length > 0 ? (
            <p className="px-4 text-subhead tabular-nums text-ink-muted [overflow-wrap:anywhere]">{contact.join(" · ")}</p>
          ) : null}

          <section aria-labelledby="history-title">
            <h2 id="history-title" className="group-label">Randevu geçmişi</h2>
            {result.customer.appointments.length ? (
              <ul className="inset-group">
                {result.customer.appointments.map((appointment) => (
                  <li key={appointment.id} className="inset-row px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-subhead font-semibold text-ink">{appointment.serviceName}</span>
                      <span className={`${badgeBase} ${appointmentStatusBadge[appointment.status] ?? "bg-surface-muted text-ink"}`}>
                        {appointmentStatusLabel[appointment.status] ?? appointment.status}
                      </span>
                    </div>
                    <p className="mt-1 text-footnote tabular-nums text-ink-muted">
                      <time dateTime={new Date(appointment.startAt).toISOString()}>{formatAppointmentDateTime(appointment.startAt)}</time>
                      {" · "}
                      {appointment.staffDisplayName}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="inset-group p-5 text-subhead text-ink-muted">Henüz randevu geçmişi yok.</p>
            )}
          </section>

          <section aria-labelledby="notes-title">
            <h2 id="notes-title" className="group-label">Notlar</h2>
            <div className="inset-group p-4">
              {result.customer.notes.length ? (
                <ul className="space-y-2">
                  {result.customer.notes.map((note) => (
                    <li key={note.id} className="rounded-control bg-surface-muted p-3 text-subhead text-ink [overflow-wrap:anywhere]">{note.body}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-subhead text-ink-muted">Henüz not yok.</p>
              )}
              <CustomerNoteForm customerId={result.customer.id} />
            </div>
          </section>
        </div>
      </main>
    );
  }

  const result = await getCustomers(query.q ?? "");
  if (result.status !== "ok") {
    return (
      <main className="min-h-screen bg-canvas p-6">
        <h1 className="text-title text-ink">Müşteriler yüklenemedi</h1>
      </main>
    );
  }

  const count = result.customers.length;

  return (
    <main className="min-h-screen bg-canvas">
      {/* A main tab: no breadcrumb back to "Yönetim" (the tab bar is the way around). */}
      <PageHeader
        title="Müşteriler"
        eyebrow={<span className="tabular-nums">{query.q ? `${count} sonuç` : `${count} kayıt`}</span>}
        widthClassName="max-w-5xl"
      />
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8">
        <form method="get" className="flex gap-2">
          <label className="sr-only" htmlFor="customer-search">Müşteri ara</label>
          <input
            id="customer-search"
            name="q"
            type="search"
            enterKeyHint="search"
            defaultValue={query.q ?? ""}
            placeholder="Ad, e-posta veya telefon ara"
            className={`${field} min-w-0 flex-1`}
          />
          <Button type="submit" leadingIcon={Search} iconOnly aria-label="Ara" />
        </form>

        {count ? (
          <CustomerList customers={result.customers} now={new Date()} />
        ) : (
          <p className="inset-group p-8 text-center text-body text-ink-muted">
            {query.q ? "Aramanızla eşleşen müşteri bulunamadı." : "Henüz müşteri kaydı bulunmuyor."}
          </p>
        )}
      </div>
    </main>
  );
}

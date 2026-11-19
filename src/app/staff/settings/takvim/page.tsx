export const dynamic = "force-dynamic";

import { House } from "lucide-react";
import { redirect } from "next/navigation";

import { CalendarFeedPanel } from "../../../_ui/calendar-feed-panel";
import { PageHeader } from "../../../_ui/page-header";
import { readPushBindingKey } from "../../../_ui/push-binding-key";

// Phone calendar subscription (ADR-045). The key is a non-authoritative "signed in" hint; the
// panel's actions check the session and the active staff row themselves.
export default async function StaffCalendarFeedPage() {
  const pushBindingKey = await readPushBindingKey();
  if (!pushBindingKey) redirect("/login");
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <PageHeader
        title="Telefon takvimi"
        breadcrumb={[{ label: "Özet", href: "/staff", icon: House }, { label: "Ayarlar", href: "/staff/settings" }, { label: "Telefon takvimi" }]}
      />
      <div className="mx-auto w-full max-w-xl space-y-8 px-4 pb-10 pt-6 sm:px-6">
        <CalendarFeedPanel scope="STAFF_SELF" />
        <p className="px-4 text-footnote text-ink-muted">
          Randevuyu bu uygulamada oluşturun veya değiştirin; telefon takviminiz birkaç dakika içinde güncellenir (Google Takvim saatler
          sürebilir). Telefonda yaptığınız değişiklikler uygulamaya geri gelmez.
        </p>
      </div>
    </main>
  );
}

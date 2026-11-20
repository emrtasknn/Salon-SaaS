export const dynamic = "force-dynamic";

import { House } from "lucide-react";
import { redirect } from "next/navigation";

import { CalendarFeedPanel } from "../../../_ui/calendar-feed-panel";
import { GoogleCalendarPanel } from "../../../_ui/google-calendar-panel";
import { PhoneCalendarPanel } from "../../../_ui/phone-calendar-panel";
import { PageHeader } from "../../../_ui/page-header";
import { readPushBindingKey } from "../../../_ui/push-binding-key";

// Phone calendar subscription (ADR-045). The key is a non-authoritative "signed in" hint; the
// panel's actions check the session and the active staff row themselves.
export default async function StaffCalendarFeedPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const pushBindingKey = await readPushBindingKey();
  if (!pushBindingKey) redirect("/login");
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <PageHeader
        title="Telefon takvimi"
        breadcrumb={[{ label: "Özet", href: "/staff", icon: House }, { label: "Ayarlar", href: "/staff/settings" }, { label: "Telefon takvimi" }]}
      />
      <div className="mx-auto w-full max-w-xl space-y-8 px-4 pb-10 pt-6 sm:px-6">
        <PhoneCalendarPanel />
        <GoogleCalendarPanel area="staff" result={google} />
        <CalendarFeedPanel scope="STAFF_SELF" />
        <p className="px-4 text-footnote text-ink-muted">
          Abonelik bağlantısı tek yönlüdür: randevular telefonunuzda görünür, telefonda yaptığınız değişiklikler uygulamaya gelmez.
          İki yönlü kullanım için yukarıdaki iPhone / Mac takvimini (veya Google Takvim&apos;i) kullanın.
        </p>
      </div>
    </main>
  );
}

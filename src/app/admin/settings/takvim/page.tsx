export const dynamic = "force-dynamic";

import { House } from "lucide-react";
import { redirect } from "next/navigation";

import { CalendarFeedPanel } from "../../../_ui/calendar-feed-panel";
import { GoogleCalendarPanel } from "../../../_ui/google-calendar-panel";
import { PhoneCalendarPanel } from "../../../_ui/phone-calendar-panel";
import { PageHeader } from "../../../_ui/page-header";
import { readPushBindingKey } from "../../../_ui/push-binding-key";
import { readAdminStaffFlag } from "../../admin-staff-flag";

// Phone calendar subscription (ADR-045). The key is a non-authoritative "signed in" hint; the
// panel's actions check the session and the admin role themselves.
export default async function AdminCalendarFeedPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const [pushBindingKey, servesAsStaff] = await Promise.all([readPushBindingKey(), readAdminStaffFlag()]);
  if (!pushBindingKey) redirect("/login");
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <PageHeader
        title="Telefon takvimi"
        breadcrumb={[{ label: "Yönetim", href: "/admin", icon: House }, { label: "Ayarlar", href: "/admin/settings" }, { label: "Telefon takvimi" }]}
      />
      <div className="mx-auto w-full max-w-xl space-y-8 px-4 pb-10 pt-6 sm:px-6">
        <PhoneCalendarPanel />
        <GoogleCalendarPanel area="admin" result={google} />
        <CalendarFeedPanel scope="TENANT_ALL" />
        {servesAsStaff ? <CalendarFeedPanel scope="STAFF_SELF" /> : null}
        <p className="px-4 text-footnote text-ink-muted">
          Abonelik bağlantısı tek yönlüdür: randevular telefonunuzda görünür, telefonda yaptığınız değişiklikler uygulamaya gelmez.
          İki yönlü kullanım için yukarıdaki iPhone / Mac takvimini (veya Google Takvim&apos;i) kullanın.
        </p>
      </div>
    </main>
  );
}

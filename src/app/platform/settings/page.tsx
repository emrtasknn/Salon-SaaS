export const dynamic = "force-dynamic";

import { Building2 } from "lucide-react";
import { readPlatformAccess } from "../tenants/actions";
import { SettingsScreen } from "../../_ui/settings-screen";

// Device settings for the platform SUPER_ADMIN: appearance, vibration, password. No push row:
// platform accounts have no tenant and receive no appointment notifications.
export default async function PlatformSettingsPage() {
  if (!(await readPlatformAccess())) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-title text-ink">Yetkisiz erişim</h1>
        <p className="mt-2 text-body text-ink-muted">Bu alan yalnızca platform SUPER_ADMIN hesabı içindir.</p>
      </main>
    );
  }
  return <SettingsScreen home={{ label: "İşletmeler", href: "/platform/tenants", icon: Building2 }} />;
}

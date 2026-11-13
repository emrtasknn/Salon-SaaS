export const dynamic = "force-dynamic";

import { loadTenantSettings } from "../settings-actions";
import { TenantSettingsForm } from "../tenant-settings-form";
import { AdminSubpage, AdminUnauthorized } from "../admin-management";

// Settings, Konum and KVKK fields. Tenant comes only from the session; the form's
// `canEdit` is a UI hint and updateTenantSettingsAction re-checks the role.
export default async function AdminSalonPage() {
  const settings = await loadTenantSettings();
  if (!settings.ok && settings.code === "FORBIDDEN") return <AdminUnauthorized />;
  return (
    <AdminSubpage title="İşletme bilgileri">
      {settings.ok ? (
        <TenantSettingsForm settings={settings.settings} canEdit={settings.canEdit === true} />
      ) : (
        <p role="alert" className="inset-group p-4 text-body text-ink">
          İşletme bilgileri yüklenemedi. Sayfayı yenileyip tekrar deneyin.
        </p>
      )}
    </AdminSubpage>
  );
}

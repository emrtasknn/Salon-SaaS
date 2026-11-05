import { statusNote } from "../../_ui/styles";
import { listPlatformTenants, readPlatformAccess } from "./actions";
import { TenantProvisioningForm } from "./tenant-provisioning-form";
import { TenantStatusList } from "./tenant-status-list";

export const dynamic = "force-dynamic";

export default async function PlatformTenantsPage() {
  const allowed = await readPlatformAccess();

  if (!allowed) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-title text-ink">Yetkisiz erişim</h1>
        <p className="mt-2 text-body text-ink-muted">Bu alan yalnızca platform SUPER_ADMIN hesabı içindir.</p>
      </main>
    );
  }

  const tenants = await listPlatformTenants();

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-3xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-large-title text-ink">Salonlar</h1>

        <section aria-labelledby="tenant-list-title" className="space-y-2">
          <h2 id="tenant-list-title" className="group-label">Salon listesi</h2>
          {tenants.ok ? (
            <TenantStatusList tenants={tenants.tenants} />
          ) : (
            <p role="status" className={statusNote}>Salon listesi yüklenemedi.</p>
          )}
        </section>

        <section aria-labelledby="tenant-create-title" className="space-y-3">
          <div>
            <h2 id="tenant-create-title" className="text-title text-ink">Salon oluştur</h2>
            <p className="mt-1 text-subhead text-ink-muted">Yeni salon ve ilk tenant admin hesabını oluşturun.</p>
          </div>
          <TenantProvisioningForm />
        </section>
      </div>
    </main>
  );
}

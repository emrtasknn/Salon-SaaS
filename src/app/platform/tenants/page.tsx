import { listPlatformTenants, readPlatformAccess } from "./actions";
import { PlatformTenantsView } from "./platform-tenants-view";

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

  return <PlatformTenantsView tenants={tenants.ok ? tenants.tenants : null} />;
}

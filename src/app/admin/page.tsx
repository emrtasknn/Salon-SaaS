export const dynamic = "force-dynamic";

import { listAdminData } from "./actions";
import { listAdminNotifications } from "./calendar-actions";
import { loadTenantSettings } from "./settings-actions";
import { AdminManagement } from "./admin-management";
import { TenantSettingsForm } from "./tenant-settings-form";
import { InAppNotifications } from "../in-app-notifications";
import { listClosures } from "./closure-actions";
import { AdminClosures } from "./closures";
import { upcomingClosureRange } from "../../domain/closure-date";
import type { ClosureListResult } from "../appointment-create-contract";
import { createHash } from "node:crypto";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { PushPermission } from "../pwa/push-permission";
import { redirect } from "next/navigation";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { getPrisma } from "../../infrastructure/prisma-runtime";

/**
 * Navigation only: the login form sends every tenant user to /admin, so staff
 * members are forwarded to /staff (which re-checks authorization itself).
 * Never used to grant access.
 */
async function isStaffMember(): Promise<boolean> {
  try {
    const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
    const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
    if (request.state !== "authenticated") return false;
    const membership = await createPrismaMembershipReader({ prisma: getPrisma() }).readMembership({
      tenantContext: request.tenantContext, identity: request.identity,
    });
    return membership.status === "found" && membership.membership.role === "STAFF";
  } catch {
    return false;
  }
}

/**
 * WP-09: opaque, non-authoritative device-binding key for the push opt-in UI
 * (hash of tenant + auth subject). Never used for authorization; the push
 * actions derive tenant/profile from the session themselves.
 */
async function readPushBindingKey(): Promise<string | null> {
  try {
    const supabase = await createNextSupabaseServerClient(readSupabaseServerClientConfig());
    const request = await readAuthenticatedTenantRequest(createSupabaseAuthAdapter({ client: supabase as never }));
    if (request.state !== "authenticated") return null;
    return createHash("sha256")
      .update(`${request.tenantContext.tenantId}:${request.identity.subjectId}`)
      .digest("hex")
      .slice(0, 32);
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  if (await isStaffMember()) redirect("/staff");
  const closureRange = upcomingClosureRange();
  const [data, notifications, settings, closures, pushBindingKey] = await Promise.all([
    listAdminData(),
    listAdminNotifications(),
    loadTenantSettings(),
    // A closure read failure must not take down the whole admin page; the panel
    // shows "could not load" for INVALID_INPUT.
    listClosures(closureRange).catch((): ClosureListResult => ({ status: "INVALID_INPUT" })),
    readPushBindingKey(),
  ]);
  const authorized = data.status !== "UNAUTHORIZED";
  return <>
    {authorized && settings.ok && settings.settings.status === "INACTIVE" && (
      <div className="bg-zinc-100 px-4 pt-4 sm:px-6">
        <p role="status" className="mx-auto max-w-6xl rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
          Salonunuz şu anda pasif — online ve yeni randevu alınmıyor.
        </p>
      </div>
    )}
    {authorized && pushBindingKey && (
      <PushPermission bindingKey={pushBindingKey} className="bg-zinc-100 px-4 pt-4 sm:px-6" widthClassName="max-w-6xl" />
    )}
    <InAppNotifications initialData={notifications} reload={listAdminNotifications} href="/admin/calendar" className="bg-zinc-100 px-4 pt-4 sm:px-6" widthClassName="max-w-6xl" />
    <AdminManagement
      initialData={data}
      settings={authorized ? <>
        {settings.ok && <TenantSettingsForm settings={settings.settings} canEdit={settings.canEdit === true} />}
        <AdminClosures initialData={closures} initialRange={closureRange} />
      </> : undefined}
    />
  </>;
}

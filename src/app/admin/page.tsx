export const dynamic = "force-dynamic";

import Link from "next/link";
import { listAdminData } from "./actions";
import { listAdminAppointments, listAdminNotifications } from "./calendar-actions";
import { loadTenantSettings } from "./settings-actions";
import { AdminUnauthorized } from "./admin-management";
import { InAppNotifications } from "../in-app-notifications";
import { createHash } from "node:crypto";
import { readAuthenticatedTenantRequest } from "../../application/auth-request-boundary";
import { createSupabaseAuthAdapter } from "../../infrastructure/auth/supabase-auth-adapter";
import { createNextSupabaseServerClient } from "../../infrastructure/auth/supabase-server-client";
import { readSupabaseServerClientConfig } from "../../infrastructure/auth/supabase-server-env";
import { PushPermission } from "../pwa/push-permission";
import { redirect } from "next/navigation";
import { createPrismaMembershipReader } from "../../persistence/prisma-membership-reader";
import { getPrisma } from "../../infrastructure/prisma-runtime";
import { AccountLinks } from "../_ui/account-links";
import { PageHeader } from "../_ui/page-header";
import { formatGreetingDate, localDateIso } from "../_ui/greeting";
import { readViewerGreeting } from "../_ui/viewer-greeting";
import { greetingName } from "../_ui/display-name";
import { pendingSummaryText } from "./dashboard-summary";
import { setupSteps } from "./setup-steps";
import { Check } from "lucide-react";

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

type TodaySummary = { total: number; pending: number } | null;

/** Read-only counts for the "Bugün" card; a failure only hides the numbers. */
async function readTodaySummary(dateIso: string): Promise<TodaySummary> {
  try {
    const result = await listAdminAppointments(dateIso);
    if (result.status !== "ok") return null;
    const live = result.appointments.filter((a) => a.status !== "CANCELLED" && a.status !== "REJECTED");
    return { total: live.length, pending: live.filter((a) => a.status === "PENDING").length };
  } catch {
    return null;
  }
}

function Chevron() {
  return <span aria-hidden="true" className="text-title leading-none text-ink-muted">›</span>;
}

/** iOS-Settings style row: label, optional detail value, chevron. Whole row is the link. */
function SettingsRow({ href, label, detail, warn = false }: { href: string; label: string; detail?: string; warn?: boolean }) {
  return (
    <li className="inset-row">
      <Link
        href={href}
        className="focus-ring tap-target flex items-center gap-3 px-4 py-3 text-body text-ink [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted"
      >
        <span className="min-w-0 flex-1">{label}</span>
        {detail && (
          <span className={`shrink-0 text-subhead tabular-nums ${warn ? "font-semibold text-status-pending" : "text-ink-muted"}`}>
            {detail}
          </span>
        )}
        <Chevron />
      </Link>
    </li>
  );
}

export default async function AdminPage() {
  if (await isStaffMember()) redirect("/staff");
  const now = new Date();
  const [data, notifications, settings, pushBindingKey, greeting, today] = await Promise.all([
    listAdminData(),
    listAdminNotifications(),
    loadTenantSettings(),
    readPushBindingKey(),
    readViewerGreeting(),
    readTodaySummary(localDateIso(now)),
  ]);
  if (data.status === "UNAUTHORIZED") return <AdminUnauthorized />;

  const staffCount = data.staff.status === "listed" && data.staff.staff
    ? data.staff.staff.filter((s) => s.status === "ACTIVE").length
    : null;
  const serviceCount = data.services.status === "listed"
    ? data.services.services.filter((s) => s.active).length
    : null;
  const openDays = data.workingHours.status === "listed" ? data.workingHours.workingHours.length : null;
  const salonName = (settings.ok ? settings.settings.name : null) ?? greeting.tenantName;
  const allPending = notifications.status === "ok" ? notifications.pendingCount : null;
  const legal = settings.ok ? settings.settings.legal : null;
  const legalMissing = legal ? !(legal.legalName && legal.legalAddress && legal.kvkkContactEmail) : false;
  const steps = setupSteps({ staffCount, serviceCount, openDays, legalMissing });
  const remaining = steps.filter((step) => !step.done).length;
  const anyPending = (allPending ?? 0) > 0 || (today?.pending ?? 0) > 0;
  const firstName = greetingName(greeting.displayName);

  return (
    <main className="min-h-screen bg-canvas text-ink">
      {settings.ok && settings.settings.status === "INACTIVE" && (
        <div className="px-4 pt-4 sm:px-6">
          <p role="status" className="mx-auto max-w-xl rounded-control bg-status-pending-bg p-3.5 text-subhead font-medium text-status-pending">
            Salonunuz şu anda pasif — online ve yeni randevu alınmıyor.
          </p>
        </div>
      )}
      <PageHeader
        eyebrow={<>{salonName ? `${salonName} · ` : ""}<span className="tabular-nums">{formatGreetingDate(now)}</span></>}
        title={firstName ? `Merhaba, ${firstName}` : "Merhaba"}
        accessory={<InAppNotifications initialData={notifications} reload={listAdminNotifications} href="/admin/calendar" />}
      />

      <div className="mx-auto w-full max-w-xl space-y-8 px-4 pb-10 pt-4 sm:px-6">
        {pushBindingKey ? <PushPermission bindingKey={pushBindingKey} className="w-full" /> : null}
        {remaining > 0 && (
          <section aria-labelledby="setup-title">
            <h2 id="setup-title" className="group-label">Kurulum · {remaining} adım kaldı</h2>
            <p className="px-4 pb-2 text-subhead text-ink-muted">Bu adımlar bitince müşterileriniz online randevu alabilir.</p>
            <ol className="inset-group">
              {steps.map((step, index) => (
                <li key={step.href} className="inset-row">
                  <Link
                    href={step.href}
                    className="focus-ring tap-target flex items-center gap-3 px-4 py-3 text-body text-ink [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-footnote font-semibold tabular-nums ${
                        step.done ? "bg-status-confirmed-bg text-status-confirmed" : "bg-surface-muted text-ink"
                      }`}
                    >
                      {step.done ? <Check className="size-4" strokeWidth={2.5} /> : index + 1}
                    </span>
                    <span className={`min-w-0 flex-1 ${step.done ? "text-ink-muted line-through" : ""}`}>
                      {step.label}
                      <span className="sr-only">{step.done ? " (tamamlandı)" : " (yapılacak)"}</span>
                    </span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-labelledby="today-title">
          <h2 id="today-title" className="group-label">Bugün</h2>
          <Link
            href="/admin/calendar"
            className="inset-group focus-ring flex items-center gap-4 p-4 hover:bg-surface-muted"
          >
            <div className="min-w-0 flex-1">
              {today ? (
                <>
                  <p className="text-title tabular-nums">
                    {today.total} <span className="font-sans text-headline font-semibold">randevu</span>
                  </p>
                  <p className={`mt-1 text-subhead tabular-nums ${anyPending ? "font-semibold text-status-pending" : "text-ink-muted"}`}>
                    {pendingSummaryText(today.pending, allPending)}
                  </p>
                </>
              ) : (
                <p className="text-body text-ink-muted">Bugünün randevuları yüklenemedi.</p>
              )}
            </div>
            <span className="shrink-0 text-subhead font-semibold text-ink">Takvim</span>
            <Chevron />
          </Link>
        </section>

        <section aria-labelledby="salon-settings-title">
          <h2 id="salon-settings-title" className="group-label">Salon</h2>
          <ul className="inset-group">
            <SettingsRow href="/admin/staff" label="Personel" detail={staffCount === null ? undefined : `${staffCount} aktif`} />
            <SettingsRow href="/admin/services" label="Hizmetler" detail={serviceCount === null ? undefined : `${serviceCount} aktif`} />
            <SettingsRow href="/admin/hours" label="Çalışma saatleri" detail={openDays === null ? undefined : `${openDays} gün açık`} />
            <SettingsRow
              href="/admin/salon"
              label="Salon bilgileri"
              detail={legalMissing ? "Yasal bilgi eksik" : "Konum, KVKK"}
              warn={legalMissing}
            />
          </ul>
        </section>

        <section aria-labelledby="account-title">
          <h2 id="account-title" className="group-label">Hesap</h2>
          <div className="inset-group p-4">
            <AccountLinks />
          </div>
        </section>
      </div>
    </main>
  );
}

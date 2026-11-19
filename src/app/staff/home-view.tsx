import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, ChevronRight, Clock } from "lucide-react";

import { staffHomeSummary, startsInLabel } from "./home-summary";
import { ProductTour } from "../_ui/tour/product-tour";
import { formatGreetingDate } from "../_ui/greeting";
import { PageHeader } from "../_ui/page-header";
import { AccountRows } from "../_ui/account-links";
import { appointmentHref } from "../_ui/deep-link";
import { TIMELINE_TIME_ZONE } from "../_ui/timeline-layout";
import { appointmentStatusBadge, appointmentStatusLabel, badgeBase } from "../_ui/styles";

const CALENDAR = "/staff/calendar";

const time = (iso: Date | string) =>
  new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TIMELINE_TIME_ZONE }).format(new Date(iso));
const shortDay = (iso: Date | string) =>
  new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", weekday: "short", timeZone: TIMELINE_TIME_ZONE }).format(new Date(iso));

const rowLink =
  "focus-ring tap-target flex items-center gap-3 px-4 py-3 text-body text-ink [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted";

function StatTile({ value, label, href, tone = "default" }: { value: number; label: string; href: string; tone?: "default" | "warn" }) {
  return (
    <Link href={href} className="inset-group focus-ring pressable flex flex-col gap-0.5 p-3.5 hover:bg-surface-muted">
      <span className={`text-title tabular-nums ${tone === "warn" && value > 0 ? "text-status-pending" : "text-ink"}`}>{value}</span>
      <span className="text-footnote font-semibold text-ink-muted">{label}</span>
    </Link>
  );
}

export type HomeAppointment = Readonly<{
  id: string;
  startAt: Date | string;
  endAt: Date | string;
  status: string;
  serviceName: string;
  customerName: string;
  bookingContact?: Readonly<{ displayName: string }> | null;
}>;

/** Staff home ("Özet") body. Data is loaded and authorized by the page. Presentation only. */
export function StaffHomeView({
  appointments,
  loadFailed,
  now,
  today,
  tenantName,
  firstName,
  bell,
  pushPrompt,
}: {
  appointments: readonly HomeAppointment[];
  loadFailed: boolean;
  now: Date;
  today: string;
  tenantName: string | null;
  firstName: string | null;
  bell?: ReactNode;
  pushPrompt?: ReactNode;
}) {
  const summary = staffHomeSummary(appointments, now.getTime(), today);
  const customerOf = (a: HomeAppointment) => a.bookingContact?.displayName ?? a.customerName;
  const next = summary.next;

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <PageHeader
        eyebrow={<>{tenantName ? `${tenantName} · ` : ""}<span className="tabular-nums">{formatGreetingDate(now)}</span></>}
        title={firstName ? `Merhaba, ${firstName}` : "Merhaba"}
        accessory={bell}
      />

      <div className="mx-auto w-full max-w-xl space-y-8 px-4 pb-10 pt-4 sm:px-6">
        {pushPrompt}
        {loadFailed ? (
          <p role="status" className="inset-group p-4 text-body text-ink-muted">Randevular yüklenemedi. Sayfayı yenileyin.</p>
        ) : null}

        <section aria-labelledby="next-title" data-tour="next">
          <h2 id="next-title" className="group-label">Sıradaki randevu</h2>
          {next ? (
            <Link href={appointmentHref(CALENDAR, { appointmentId: next.id, startAt: next.startAt })} className="inset-group focus-ring pressable flex items-center gap-4 p-4 hover:bg-surface-muted">
              <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-control bg-tint text-on-tint">
                <Clock className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-title tabular-nums">
                  {time(next.startAt)}
                  <span className="ml-2 text-subhead font-semibold text-accent-ink">
                    {startsInLabel(summary.nextStartsInMinutes ?? 0, next.startAt, today)}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-body">{customerOf(next)}</p>
                <p className="truncate text-footnote text-ink-muted">{next.serviceName}</p>
              </div>
              {next.status === "PENDING" ? <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge.PENDING}`}>{appointmentStatusLabel.PENDING}</span> : null}
              <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
            </Link>
          ) : (
            <div className="inset-group p-4 text-body text-ink-muted">Önümüzdeki 7 günde randevunuz yok.</div>
          )}
        </section>

        <section aria-label="Özet sayılar" className="grid grid-cols-3 gap-2">
          <StatTile value={summary.todayRemaining} label="Bugün kalan" href={CALENDAR} />
          <StatTile value={summary.pending.length} label="Bekleyen" href={summary.pending.length > 0 ? "#pending-title" : CALENDAR} tone="warn" />
          <StatTile value={summary.weekCount} label="7 gün" href={CALENDAR} />
        </section>

        {summary.pending.length > 0 ? (
          <section aria-labelledby="pending-title">
            <h2 id="pending-title" className="group-label">Onay bekleyen talepler</h2>
            <ul className="inset-group">
              {summary.pending.slice(0, 5).map((a) => (
                <li key={a.id} className="inset-row">
                  <Link href={appointmentHref(CALENDAR, { appointmentId: a.id, startAt: a.startAt })} className={rowLink}>
                    <span className="w-24 shrink-0 text-subhead tabular-nums text-ink-muted">{shortDay(a.startAt)}<br />{time(a.startAt)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{customerOf(a)}</span>
                      <span className="block truncate text-footnote text-ink-muted">{a.serviceName}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
            {summary.pending.length > 5 ? (
              <p className="px-4 pt-2 text-footnote text-ink-muted">+{summary.pending.length - 5} talep daha. Takvimden görebilirsiniz.</p>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="today-title" data-tour="today">
          <div className="flex items-end justify-between">
            <h2 id="today-title" className="group-label">Bugün</h2>
            <Link href={CALENDAR} className="focus-ring mb-1.5 inline-flex items-center gap-1 rounded px-2 text-subhead font-semibold text-ink hover:underline">
              <CalendarDays className="size-4" aria-hidden /> Takvim
            </Link>
          </div>
          {summary.today.length === 0 ? (
            <div className="inset-group p-4 text-body text-ink-muted">Bugün randevunuz yok.</div>
          ) : (
            <ul className="inset-group">
              {summary.today.map((a) => {
                const over = new Date(a.endAt).getTime() <= now.getTime();
                return (
                  <li key={a.id} className="inset-row">
                    <Link href={appointmentHref(CALENDAR, { appointmentId: a.id, startAt: a.startAt })} className={`${rowLink} ${over ? "text-ink-muted" : ""}`}>
                      <span className="w-14 shrink-0 text-headline tabular-nums">{time(a.startAt)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{customerOf(a)}</span>
                        <span className="block truncate text-footnote text-ink-muted">{a.serviceName}</span>
                      </span>
                      {a.status === "PENDING" ? <span className={`${badgeBase} shrink-0 ${appointmentStatusBadge.PENDING}`}>{appointmentStatusLabel.PENDING}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="account-title" data-tour="account">
          <h2 id="account-title" className="group-label">Hesap</h2>
          <AccountRows settingsHref="/staff/settings" />
        </section>
      </div>
      <ProductTour tour="staff" />
    </main>
  );
}

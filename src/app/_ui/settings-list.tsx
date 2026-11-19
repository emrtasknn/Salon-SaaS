"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { HapticsToggle } from "./haptics-toggle";
import { ThemeToggle } from "./theme-toggle";
import { PushPermission } from "../pwa/push-permission";
import { ReplayTourRow } from "./tour/replay-tour-row";
import type { TourId } from "./tour/tour-steps";

/**
 * Device settings as one inset group: appearance, vibration, notifications, password.
 * The notifications row appears only with a push binding key (tenant users; the platform area
 * has no push). Appearance and vibration are stored on this device only. Presentation only:
 * the push actions and the password page authorize themselves.
 */
export function SettingsList({
  pushBindingKey,
  tour,
  calendarHref,
}: {
  pushBindingKey?: string | null;
  /** Phone calendar subscription page. */
  calendarHref?: string;
  /** Area tour to replay, and the page it runs on. */
  tour?: { id: TourId; href: string };
}) {
  return (
    <ul className="inset-group">
      <li className="inset-row flex min-h-11 items-center gap-3 px-4 py-2 text-body text-ink">
        <span className="min-w-0 flex-1">Görünüm</span>
        <ThemeToggle showLabel />
      </li>
      <li className="inset-row">
        <HapticsToggle row />
      </li>
      {pushBindingKey ? (
        <li className="inset-row">
          <PushPermission bindingKey={pushBindingKey} layout="row" />
        </li>
      ) : null}
      {calendarHref ? (
        <li className="inset-row">
          <Link
            href={calendarHref}
            className="focus-ring tap-target flex items-center gap-3 px-4 py-3 text-body text-ink [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted"
          >
            <span className="min-w-0 flex-1">Telefon takvimi</span>
            <span className="shrink-0 text-subhead text-ink-muted">Apple, Google</span>
            <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
          </Link>
        </li>
      ) : null}
      {tour ? (
        <li className="inset-row">
          <ReplayTourRow tour={tour.id} href={tour.href} />
        </li>
      ) : null}
      <li className="inset-row">
        <Link
          href="/reset-password"
          className="focus-ring tap-target flex items-center gap-3 px-4 py-3 text-body text-ink [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted"
        >
          <span className="min-w-0 flex-1">Şifremi değiştir</span>
          <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
        </Link>
      </li>
    </ul>
  );
}

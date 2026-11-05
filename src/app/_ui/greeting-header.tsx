import type { ReactNode } from "react";

/**
 * "Merhaba, {name}" header for the signed-in home screens. Display only: the
 * name/salon come from the session-bound server read, never from the client.
 * `accessory` sits top-right (e.g. the compact notification bell); a wide
 * accessory (banner) wraps onto its own line below the greeting.
 */
export function GreetingHeader({
  displayName,
  tenantName,
  dateLabel,
  accessory,
  widthClassName = "max-w-xl",
  asHeading = true,
}: {
  displayName: string | null;
  tenantName: string | null;
  dateLabel: string;
  accessory?: ReactNode;
  widthClassName?: string;
  /** false when the page already has its own h1 (e.g. the staff calendar). */
  asHeading?: boolean;
}) {
  const Greeting = asHeading ? "h1" : "p";
  return (
    <header className={`mx-auto flex w-full ${widthClassName} flex-wrap items-start justify-between gap-x-3 gap-y-3 px-4 pb-3 pt-6 sm:px-6`}>
      <div className="min-w-0 flex-1">
        <p className="text-footnote font-semibold text-ink-muted [overflow-wrap:anywhere]">
          {tenantName ? `${tenantName} · ` : ""}
          <span className="tabular-nums">{dateLabel}</span>
        </p>
        <Greeting className={`mt-1 text-ink [overflow-wrap:anywhere] ${asHeading ? "text-large-title" : "text-title"}`}>
          {displayName ? `Merhaba, ${displayName}` : "Merhaba"}
        </Greeting>
      </div>
      {accessory}
    </header>
  );
}

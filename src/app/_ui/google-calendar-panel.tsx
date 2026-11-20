"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { disconnectGoogleCalendar, getGoogleCalendarStatus, syncGoogleCalendarNow, type GoogleCalendarView } from "../google-calendar-actions";
import { ConfirmButton } from "./confirm-button";
import { formatShortDate } from "./date-format";

const resultMessages: Record<string, string> = {
  connected: "Google Takvim bağlandı. İlk eşitleme birkaç dakika içinde tamamlanır.",
  cancelled: "Google bağlantısı iptal edildi.",
  scope: "Google'da gerekli izin verilmedi. Tekrar bağlanırken iki izni de onaylayın.",
  error: "Google Takvim bağlanamadı. Tekrar deneyin.",
  unavailable: "Google Takvim bağlantısı bu sunucuda henüz açık değil.",
};

const time = (iso: string) =>
  `${formatShortDate(iso, new Date())} ${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(iso))}`;

/**
 * ADR-045 phase B: connect the user's Google Calendar both ways. Hidden entirely when the server
 * has no Google OAuth configuration. The actions check the session themselves.
 */
export function GoogleCalendarPanel({ area, result }: { area: "admin" | "staff"; result?: string }) {
  const [state, setState] = useState<GoogleCalendarView | null>(null);
  const [busy, start] = useTransition();
  const [message, setMessage] = useState(result ? resultMessages[result] ?? "" : "");

  useEffect(() => {
    let alive = true;
    getGoogleCalendarStatus().then((value) => alive && setState(value)).catch(() => alive && setState({ status: "UNAUTHORIZED" }));
    return () => {
      alive = false;
    };
  }, []);

  if (!state || state.status === "unavailable" || state.status === "UNAUTHORIZED") return null;

  return (
    <section aria-labelledby="google-calendar-title" className="space-y-2">
      <h2 id="google-calendar-title" className="group-label">Google Takvim (iki yönlü)</h2>
      <div className="inset-group space-y-4 p-4">
        <ul className="list-disc space-y-1 pl-5 text-body text-ink-muted">
          <li>Randevular Google hesabınızda &quot;RandevuN&quot; adlı ayrı bir takvime anında yazılır.</li>
          {state.busyApplies ? (
            <li>Google Takviminizde dolu olan saatler online randevuya kapanır. Uygulamadan elle randevu eklemeniz engellenmez.</li>
          ) : null}
          <li>Uygulama diğer takvimlerinizin yalnızca dolu/boş bilgisini görür, etkinlik içeriklerini görmez.</li>
        </ul>
        {state.connected ? (
          <div className="space-y-3">
            <p className="text-subhead text-ink">
              Bağlı{state.accountEmail ? `: ${state.accountEmail}` : ""}
              {state.lastSyncAt ? ` · son eşitleme ${time(state.lastSyncAt)}` : " · ilk eşitleme bekleniyor"}
            </p>
            {state.health === "error" ? (
              <p className="text-subhead font-semibold text-status-pending">Son eşitlemede sorun oldu. &quot;Şimdi eşitle&quot; ile tekrar deneyin.</p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                pending={busy}
                onClick={() => start(async () => {
                  setState(await syncGoogleCalendarNow());
                  setMessage("Eşitlendi.");
                })}
                className="sm:flex-1"
              >
                Şimdi eşitle
              </Button>
              <ConfirmButton
                label="Bağlantıyı kes"
                question="Google Takvim bağlantısı kesilsin mi?"
                detail="Google'daki dolu saatler artık online randevuyu etkilemez. RandevuN takvimini Google'dan kendiniz silebilirsiniz."
                confirmLabel="Evet, kes"
                variant="danger-outline"
                disabled={busy}
                onConfirm={() => start(async () => {
                  setState(await disconnectGoogleCalendar());
                  setMessage("Google Takvim bağlantısı kesildi.");
                })}
                className="sm:flex-1"
              />
            </div>
          </div>
        ) : (
          <a
            href={`/api/google-calendar/connect?area=${area}`}
            className="pressable focus-ring inline-flex min-h-11 w-full items-center justify-center rounded-control bg-action px-4 text-body font-semibold text-on-action hover:bg-action-hover"
          >
            Google Takvim&apos;i bağla
          </a>
        )}
        {message ? <p role="status" className="text-subhead text-ink">{message}</p> : null}
      </div>
    </section>
  );
}

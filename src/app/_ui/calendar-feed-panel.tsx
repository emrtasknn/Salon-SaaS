"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import type { CalendarFeedScope } from "../../domain/calendar-feed";
import { createCalendarFeedLink, getCalendarFeedStatus, revokeCalendarFeedLink, type CalendarFeedLinkView, type CalendarFeedView } from "../calendar-feed-actions";
import { ConfirmButton } from "./confirm-button";
import { formatShortDate } from "./date-format";

const copy: Record<CalendarFeedScope, { title: string; body: string }> = {
  STAFF_SELF: {
    title: "Kendi randevularım",
    body: "Size atanan randevular telefonunuzun takviminde görünür; onay, iptal ve saat değişiklikleri kendiliğinden yansır.",
  },
  TENANT_ALL: {
    title: "Tüm salon randevuları",
    body: "Bütün personelin randevuları, personel adıyla birlikte telefonunuzun takviminde görünür.",
  },
};

type Link = Extract<CalendarFeedLinkView, { status: "ok" }>;

/**
 * One calendar link (ADR-045): create it, add it to Apple/Google Calendar, renew or turn it off.
 * The link is shown only right after it is created (only its hash is stored). Presentation only;
 * the actions check the session and role themselves.
 */
export function CalendarFeedPanel({ scope }: { scope: CalendarFeedScope }) {
  const [state, setState] = useState<CalendarFeedView | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getCalendarFeedStatus(scope).then((result) => alive && setState(result)).catch(() => alive && setState({ status: "UNAUTHORIZED" }));
    return () => {
      alive = false;
    };
  }, [scope]);

  function create() {
    haptic("selection");
    setMessage("");
    start(async () => {
      const result = await createCalendarFeedLink(scope);
      if (result.status !== "ok") {
        setMessage("Bağlantı oluşturulamadı.");
        return;
      }
      setLink(result);
      setState({ status: "ok", active: true, createdAt: new Date().toISOString(), lastUsedAt: null });
    });
  }

  function revoke() {
    start(async () => {
      const result = await revokeCalendarFeedLink(scope);
      setLink(null);
      setState(result);
      setMessage(result.status === "ok" ? "Bağlantı kapatıldı. Telefonunuzdaki takvim artık güncellenmez; isterseniz oradan da silebilirsiniz." : "İşlem yapılamadı.");
    });
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.httpsUrl);
      haptic("success");
      setMessage("Bağlantı kopyalandı.");
    } catch {
      setMessage("Kopyalanamadı. Bağlantıyı elle seçip kopyalayın.");
    }
  }

  const text = copy[scope];
  return (
    <section aria-labelledby={`feed-${scope}`} className="space-y-2">
      <h2 id={`feed-${scope}`} className="group-label">{text.title}</h2>
      <div className="inset-group space-y-4 p-4">
        <p className="text-body text-ink-muted">{text.body}</p>
        {state === null ? (
          <p className="text-subhead text-ink-muted">Yükleniyor…</p>
        ) : state.status !== "ok" ? (
          <p className="text-subhead text-ink-muted">Bu bağlantı hesabınıza açık değil.</p>
        ) : link ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <a href={link.webcalUrl} className="pressable focus-ring inline-flex min-h-11 flex-1 items-center justify-center rounded-control bg-action px-4 text-body font-semibold text-on-action hover:bg-action-hover">
                iPhone / Mac Takvimine ekle
              </a>
              <a href={link.googleUrl} target="_blank" rel="noopener noreferrer" className="pressable focus-ring inline-flex min-h-11 flex-1 items-center justify-center rounded-control border border-field-border bg-surface px-4 text-body font-semibold text-ink hover:bg-surface-muted">
                Google Takvim&apos;e ekle
              </a>
            </div>
            <Button type="button" variant="secondary" onClick={copyLink} className="w-full">
              Bağlantıyı kopyala
            </Button>
            <p className="text-footnote text-ink-muted">
              Android&apos;de Google Takvim&apos;e ekleyin; telefonunuzdaki takvim uygulaması Google hesabınızdan görür. Bu bağlantıyı kimseyle
              paylaşmayın: bağlantıya sahip olan herkes randevuları görebilir.
            </p>
          </div>
        ) : state.active ? (
          <div className="space-y-3">
            <p className="text-subhead text-ink">
              Bağlantı açık
              {state.createdAt ? ` · ${formatShortDate(state.createdAt, new Date())} tarihinde oluşturuldu` : ""}
              {state.lastUsedAt ? ` · son eşitleme ${formatShortDate(state.lastUsedAt, new Date())}` : ""}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <ConfirmButton
                label="Yeni bağlantı oluştur"
                question="Yeni bağlantı oluşturulsun mu?"
                detail="Eski bağlantı çalışmaz; telefonunuza yeni bağlantıyı eklemeniz gerekir."
                confirmLabel="Evet, yenile"
                variant="secondary"
                disabled={busy}
                onConfirm={create}
                className="sm:flex-1"
              />
              <ConfirmButton
                label="Bağlantıyı kapat"
                question="Bağlantı kapatılsın mı?"
                detail="Telefonunuzdaki takvim artık güncellenmez."
                confirmLabel="Evet, kapat"
                variant="danger-outline"
                disabled={busy}
                onConfirm={revoke}
                className="sm:flex-1"
              />
            </div>
          </div>
        ) : (
          <Button type="button" variant="primary" pending={busy} onClick={create} className="w-full">
            Telefon takvimine bağla
          </Button>
        )}
        {message ? <p role="status" className="text-subhead text-ink">{message}</p> : null}
      </div>
    </section>
  );
}

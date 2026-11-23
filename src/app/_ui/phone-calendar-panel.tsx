"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import {
  createPhoneCalendarAccount,
  getPhoneCalendarStatus,
  revokePhoneCalendarAccount,
  type PhoneCalendarCredentials,
  type PhoneCalendarView,
} from "../phone-calendar-actions";
import { ConfirmButton } from "./confirm-button";
import { formatShortDate } from "./date-format";

type Credentials = Extract<PhoneCalendarCredentials, { status: "ok" }>;

const time = (iso: string) =>
  `${formatShortDate(iso, new Date())} ${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(iso))}`;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-control bg-surface-muted px-3 py-2">
      <span className="text-footnote font-semibold text-ink-muted">{label}</span>
      <span className="select-all break-all text-right font-mono text-subhead text-ink">{value}</span>
    </div>
  );
}

/**
 * ADR-045 phase C: the RandevuN calendar account, two-way with the phone's own calendar app.
 * "iPhone'a kur" posts a same-origin form that returns a configuration profile; "Elle kur" shows
 * server, username and a one-time password. Presentation only; the server checks the session.
 */
export function PhoneCalendarPanel() {
  const [state, setState] = useState<PhoneCalendarView | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();

  useEffect(() => {
    let alive = true;
    getPhoneCalendarStatus().then((value) => alive && setState(value)).catch(() => alive && setState({ status: "UNAUTHORIZED" }));
    return () => {
      alive = false;
    };
  }, []);

  if (!state || state.status !== "ok") return null;

  function manual() {
    haptic("selection");
    start(async () => {
      const result = await createPhoneCalendarAccount();
      if (result.status !== "ok") {
        setMessage("Hesap oluşturulamadı.");
        return;
      }
      setCredentials(result);
      setState({ status: "ok", active: true, username: result.username, host: result.host, lastSeenAt: null });
      setMessage("");
    });
  }

  return (
    <section aria-labelledby="phone-calendar-title" className="space-y-2">
      <h2 id="phone-calendar-title" className="group-label">iPhone / Mac takvimi (iki yönlü)</h2>
      <div className="inset-group space-y-4 p-4">
        <ul className="list-disc space-y-1 pl-5 text-body text-ink-muted">
          <li>Telefonunuzun kendi Takvim uygulamasına &quot;RandevuN&quot; adlı bir takvim eklenir; randevularınız orada görünür.</li>
          <li>
            O takvimde oluşturduğunuz etkinlik birkaç dakika içinde uygulamada başlığıyla &quot;Dolu&quot; olarak görünür ve o saat online randevuya
            kapanır.
          </li>
          <li>Apple şifreniz istenmez ve saklanmaz. Android&apos;de DAVx5 uygulamasıyla da çalışır.</li>
        </ul>

        {credentials ? (
          <div className="space-y-3">
            <p className="text-subhead font-semibold text-ink">Bu bilgileri şimdi girin; parola bir daha gösterilmez.</p>
            <Field label="Sunucu" value={credentials.host} />
            <Field label="Kullanıcı adı" value={credentials.username} />
            <Field label="Parola" value={credentials.password} />
            <ol className="list-decimal space-y-1 pl-5 text-footnote text-ink-muted">
              <li>Ayarlar → Takvim → Hesaplar → Hesap Ekle → Diğer → CalDAV Hesabı Ekle.</li>
              <li>Sunucu, kullanıcı adı ve parolayı yukarıdan girip &quot;Sonraki&quot;ye dokunun.</li>
              <li>Ayarlar → Takvim → Varsayılan Takvim → &quot;RandevuN&quot; seçin; yeni etkinlikler oraya düşsün.</li>
            </ol>
          </div>
        ) : state.active ? (
          <p className="text-subhead text-ink">
            Hesap açık{state.username ? ` (${state.username})` : ""}
            {state.lastSeenAt ? ` · telefonun son eşitlemesi ${time(state.lastSeenAt)}` : " · telefon henüz bağlanmadı"}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {/* A real form POST: iOS Safari only offers to install a profile from a navigation response. */}
          <form method="post" action="/api/phone-calendar/profile">
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {state.active ? "iPhone'a yeniden kur" : "iPhone'a kur (önerilen)"}
            </Button>
          </form>
          <p className="px-1 text-footnote text-ink-muted">
            iPhone&apos;da Safari ile açın. İndirme tek başına yetmez: Ayarlar → &quot;Profil İndirildi&quot; → Yükle adımını tamamlayın. Sonra
            Ayarlar → Takvim → Varsayılan Takvim → &quot;RandevuN&quot; seçin. Daha önce kurduğunuz ve &quot;bağlanamıyor&quot; diyen RandevuN hesaplarını
            Ayarlar → Takvim → Hesaplar&apos;dan silin.
          </p>
          <Button type="button" variant="secondary" pending={busy} onClick={manual} className="w-full">
            Elle kurulum bilgilerini göster
          </Button>
          {state.active ? (
            <ConfirmButton
              label="Hesabı kapat"
              question="Takvim hesabı kapatılsın mı?"
              detail="Telefondaki RandevuN takvimi güncellenmez; telefonda eklediğiniz etkinlikler artık dolu sayılmaz."
              confirmLabel="Evet, kapat"
              variant="danger-outline"
              disabled={busy}
              onConfirm={() =>
                start(async () => {
                  setCredentials(null);
                  setState(await revokePhoneCalendarAccount());
                  setMessage("Hesap kapatıldı. iPhone'da Ayarlar → Takvim → Hesaplar'dan RandevuN'u silebilirsiniz.");
                })
              }
            />
          ) : null}
        </div>
        <p className="text-footnote text-ink-muted">
          Yeniden kurmak eski parolayı geçersiz kılar. Telefonda bir randevuyu değiştiremezsiniz; randevular uygulamadan yönetilir. Tekrarlayan
          etkinliklerin yalnızca ilki dikkate alınır.
        </p>
        {message ? <p role="status" className="text-subhead text-ink">{message}</p> : null}
      </div>
    </section>
  );
}

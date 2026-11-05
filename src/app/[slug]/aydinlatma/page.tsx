export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { loadFullNotice } from "../legal-data";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Aydınlatma Metni",
  robots: { index: false, follow: false },
};

// WP-10: full (layer 2) KVKK notice. Text is rendered on the server from the versioned
// notice and the salon's legal fields; this page only displays it.
export default async function FullNoticePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const notice = await loadFullNotice(slug);
  if (!notice) notFound();

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <Breadcrumb className="mb-3" items={[{ label: "Salon sayfası", href: `/${encodeURIComponent(slug)}` }, { label: "Randevu", href: `/${encodeURIComponent(slug)}/book` }, { label: "Aydınlatma metni" }]} />
        <article aria-labelledby="notice-title" className="space-y-5 rounded-2xl border bg-surface p-5 shadow-sm sm:p-6">
          <header className="space-y-2">
            <p className="text-sm text-ink-muted">{notice.salonName}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="notice-title" className="text-2xl font-semibold">
                Aydınlatma Metni
              </h1>
              {notice.draft && (
                <span className="rounded-full border border-status-pending/40 bg-status-pending-bg px-2 py-0.5 text-xs font-semibold tracking-wide text-status-pending">
                  TASLAK
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted">Sürüm: {notice.version}</p>
            {notice.draft && (
              <p className="text-xs text-status-pending">Bu metin taslaktır; hukuki onay sonrası güncellenebilir.</p>
            )}
          </header>

          <div className="whitespace-pre-line break-words border-t pt-5 text-sm leading-relaxed text-ink">
            {notice.text}
          </div>

          <footer className="border-t pt-5">
            <ButtonLink href={`/${encodeURIComponent(slug)}/book`} variant="secondary">
              Randevu sayfasına dön
            </ButtonLink>
          </footer>
        </article>
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadFullNotice } from "../legal-data";

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
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <article aria-labelledby="notice-title" className="space-y-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <header className="space-y-2">
            <p className="text-sm text-zinc-600">{notice.salonName}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="notice-title" className="text-2xl font-semibold">
                Aydınlatma Metni
              </h1>
              {notice.draft && (
                <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-900">
                  TASLAK
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600">Sürüm: {notice.version}</p>
            {notice.draft && (
              <p className="text-xs text-amber-900">Bu metin taslaktır; hukuki onay sonrası güncellenebilir.</p>
            )}
          </header>

          <div className="whitespace-pre-line break-words border-t pt-5 text-sm leading-relaxed text-zinc-800">
            {notice.text}
          </div>

          <footer className="border-t pt-5">
            <a
              href={`/${encodeURIComponent(slug)}/book`}
              className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              Randevu sayfasına dön
            </a>
          </footer>
        </article>
      </div>
    </main>
  );
}

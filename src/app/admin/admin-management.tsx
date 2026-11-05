"use client";

import { useState, useTransition, type ReactNode } from "react";
import { House } from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { statusNote } from "../_ui/styles";
import { listAdminData } from "./actions";

/*
 * Shared pieces of the admin settings sub-pages (/admin/staff, /admin/services,
 * /admin/hours). Presentation only: every action re-checks identity, tenant and
 * role on the server.
 */

export type AdminData = Awaited<ReturnType<typeof listAdminData>>;
export type AdminDataOk = Extract<AdminData, { status: "ok" }>;

export function message(status: string) {
  const map: Record<string, string> = {
    UNAUTHORIZED: "Bu işlem için yetkiniz yok.",
    INVALID_INPUT: "Bilgileri kontrol edin.",
    CONFLICT: "Bu kayıt mevcut veya çakışıyor.",
    PERSISTENCE_FAILURE: "Kayıt sırasında bir hata oluştu.",
    NOT_FOUND: "Kayıt bulunamadı.",
    AUTH_PROVISIONING_FAILED: "Personel hesabı oluşturulamadı.",
    COMPENSATION_FAILED: "Personel kaydı geri alınamadı. Destek gereklidir.",
  };
  return map[status] ?? "İşlem tamamlandı.";
}

/** Local copy of the admin data with a server re-read after each successful change. */
export function useAdminData(initialData: AdminData) {
  const [data, setData] = useState(initialData);
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  const refresh = () =>
    startTransition(async () => {
      const next = await listAdminData();
      setData(next);
    });

  return { data, busy, startTransition, feedback, setFeedback, refresh };
}

export function AdminUnauthorized() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
      <h1 className="text-title text-ink">Yetkisiz erişim</h1>
      <p className="mt-2 text-body text-ink-muted">Bu alan yalnızca işletme yöneticilerine açıktır.</p>
    </main>
  );
}

/** Sub-page frame: concrete back link to the hub, large title, status line. */
export function AdminSubpage({
  title,
  feedback,
  children,
}: {
  title: string;
  feedback?: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-4 sm:px-6">
        <Breadcrumb items={[{ label: "Yönetim", href: "/admin", icon: House }, { label: title }]} />
        <h1 className="mt-2 text-large-title">{title}</h1>
        {feedback && (
          // Sticky so the result of a save further down the page stays in view.
          <p role="status" className={`${statusNote} sticky top-[max(0.5rem,env(safe-area-inset-top))] z-10 mt-4`}>
            {feedback}
          </p>
        )}
        <div className="mt-6 space-y-8">{children}</div>
      </div>
    </main>
  );
}

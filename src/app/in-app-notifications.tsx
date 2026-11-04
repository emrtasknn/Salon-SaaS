"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { InAppNotificationView, InAppNotificationViewItem } from "../application/in-app-notifications";

// WP-04 / ADR-044 §3 Option A. Read-only badge + list derived from Appointment.
// Display only: the server actions resolve tenant/staff scope and authorization (WP4-R5).
// Refresh on window focus and visibilitychange → visible. No polling, no client persistence (WP4-R6).

type Props = {
  initialData: InAppNotificationView;
  reload: () => Promise<InAppNotificationView>;
  /** Where list items link to: /staff/appointments or /admin/calendar. */
  href: string;
  /** Outer strip classes so the badge sits on the host page background/width. */
  className?: string;
  /** Inner width classes matching the host page container, e.g. "max-w-5xl". */
  widthClassName?: string;
};

const labels: Record<string, string> = { PENDING: "Bekliyor", CONFIRMED: "Onaylandı", REJECTED: "Reddedildi", CANCELLED: "İptal", COMPLETED: "Tamamlandı" };

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function Item({ item, href }: { item: InAppNotificationViewItem; href: string }) {
  return <li>
    <Link href={href} className="block rounded-lg px-3 py-2 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black">
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{formatDateTime(item.startAt)} · {item.serviceName}</span>
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs">{labels[item.status] ?? item.status}</span>
      </span>
      <span className="mt-1 block text-xs text-zinc-500">
        Personel: {item.staffDisplayName}
        {item.customerDisplayName !== undefined && <> · Müşteri: {item.customerDisplayName}</>}
        {item.kind === "STATUS_CHANGED" && <> · Güncellendi: {formatDateTime(item.updatedAt)}</>}
      </span>
    </Link>
  </li>;
}

export function InAppNotifications({ initialData, reload, href, className, widthClassName }: Props) {
  const [data, setData] = useState(initialData);
  const [prevInitialData, setPrevInitialData] = useState(initialData);
  // A server re-render (navigation, router.refresh() after a decision) brings fresh initialData.
  if (initialData !== prevInitialData) {
    setPrevInitialData(initialData);
    setData(initialData);
  }
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await reload();
      // WP4-R8: a transient PERSISTENCE_FAILURE keeps the last data; UNAUTHORIZED hides the badge.
      setData((current) => (next.status === "PERSISTENCE_FAILURE" && current.status === "ok" ? current : next));
    } catch {
      // WP4-R8: failures never break the host page; keep last known data.
    } finally {
      inFlight.current = false;
    }
  }, [reload]);

  useEffect(() => {
    function onFocus() { void refresh(); }
    function onVisibility() { if (document.visibilityState === "visible") void refresh(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    }
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // WP4-R8: UNAUTHORIZED / INVALID_INPUT / PERSISTENCE_FAILURE → render nothing.
  if (data.status !== "ok") return null;

  const count = data.pendingCount;
  const buttonLabel = count > 0 ? `Bildirimler: ${count} onay bekleyen randevu` : "Bildirimler: onay bekleyen randevu yok";

  return <div className={className}>
    <div ref={rootRef} className={`relative mx-auto flex justify-end ${widthClassName ?? ""}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
      >
        <span aria-hidden="true">Bildirimler</span>
        {count > 0 && <span aria-hidden="true" className="rounded-full bg-black px-2 py-0.5 text-xs font-semibold text-white">{count}</span>}
      </button>
      {open && <div id={panelId} role="region" aria-label="Bildirimler" className="absolute right-0 top-full z-40 mt-2 max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-white p-2 text-zinc-900 shadow-lg">
        <section aria-labelledby={`${panelId}-pending`}>
          <h2 id={`${panelId}-pending`} className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Onay bekleyen ({count})</h2>
          {data.pending.length === 0
            ? <p className="px-3 py-2 text-sm text-zinc-500">Onay bekleyen randevu yok.</p>
            : <ul>{data.pending.map((item) => <Item key={item.appointmentId} item={item} href={href} />)}</ul>}
          {count > data.pending.length && <p className="px-3 py-1 text-xs text-zinc-500">İlk {data.pending.length} randevu gösteriliyor.</p>}
        </section>
        <section aria-labelledby={`${panelId}-recent`} className="mt-2 border-t pt-1">
          <h2 id={`${panelId}-recent`} className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Son değişiklikler (7 gün)</h2>
          {data.recent.length === 0
            ? <p className="px-3 py-2 text-sm text-zinc-500">Son 7 günde değişiklik yok.</p>
            : <ul>{data.recent.map((item) => <Item key={item.appointmentId} item={item} href={href} />)}</ul>}
        </section>
      </div>}
    </div>
  </div>;
}

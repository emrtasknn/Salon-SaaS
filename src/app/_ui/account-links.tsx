"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createNextSupabaseBrowserClient } from "../../infrastructure/auth/supabase-browser-client";

import { releaseWebPushSubscription } from "../pwa/push-permission";


import { ThemeToggle } from "./theme-toggle";
import { HapticsToggle } from "./haptics-toggle";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

const rowClass =
  "focus-ring tap-target flex w-full items-center gap-3 px-4 py-3 text-left text-body [outline-offset:-2px] hover:bg-surface-muted active:bg-surface-muted";

function useLogout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      // Best-effort, time-boxed; stops push to this device before the session ends.
      await releaseWebPushSubscription();
      await createNextSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }
  return { busy, logout };
}

/** "Hesap" as two list rows: Ayarlar (device settings page) and Çıkış yap. Presentation only. */
export function AccountRows({ settingsHref }: { settingsHref: string }) {
  const { busy, logout } = useLogout();
  return (
    <ul className="inset-group">
      <li className="inset-row">
        <Link href={settingsHref} className={`${rowClass} text-ink`}>
          <span className="min-w-0 flex-1">Ayarlar</span>
          <span className="shrink-0 text-subhead text-ink-muted">Görünüm, bildirimler</span>
          <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
        </Link>
      </li>
      <li className="inset-row">
        <button type="button" onClick={logout} disabled={busy} className={`${rowClass} text-destructive disabled:opacity-60`}>
          {busy ? "Çıkış yapılıyor…" : "Çıkış yap"}
        </button>
      </li>
    </ul>
  );
}

/** Appearance (theme) switch, "Change password" (uses the current session on /reset-password) and "Log out" for signed-in users. */
export function AccountLinks() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      // Same as admin logout (WP-09): best-effort, time-boxed; stops push to this device.
      await releaseWebPushSubscription();
      await createNextSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href="/reset-password" variant="secondary">Şifremi değiştir</ButtonLink>
      <Button type="button" onClick={logout} disabled={busy} variant="secondary">
        {busy ? "Çıkış yapılıyor…" : "Çıkış yap"}
      </Button>
      <ThemeToggle showLabel />
      <HapticsToggle />
    </div>
  );
}

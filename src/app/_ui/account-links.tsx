"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createNextSupabaseBrowserClient } from "../../infrastructure/auth/supabase-browser-client";

import { releaseWebPushSubscription } from "../pwa/push-permission";


import { ThemeToggle } from "./theme-toggle";
import { HapticsToggle } from "./haptics-toggle";
import { Button, ButtonLink } from "@/components/ui/button";

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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createNextSupabaseBrowserClient } from "@/infrastructure/auth/supabase-browser-client";

import { buttonSecondary } from "./styles";

/** "Change password" (uses the current session on /reset-password) and "Log out" for signed-in users. */
export function AccountLinks() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await createNextSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/reset-password" className={buttonSecondary}>Şifremi değiştir</Link>
      <button type="button" onClick={logout} disabled={busy} className={buttonSecondary}>
        {busy ? "Çıkış yapılıyor…" : "Çıkış yap"}
      </button>
    </div>
  );
}

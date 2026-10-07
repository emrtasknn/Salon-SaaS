"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createNextSupabaseBrowserClient } from "../infrastructure/auth/supabase-browser-client";

export function RecoveryRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash.includes("type=recovery")) {
      return;
    }

    const supabase = createNextSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session !== null) {
        router.replace("/reset-password");
        router.refresh();
      }
    });
  }, [router]);

  return null;
}

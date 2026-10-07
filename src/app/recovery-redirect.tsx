"use client";

import { useEffect } from "react";
import { createNextSupabaseBrowserClient } from "../infrastructure/auth/supabase-browser-client";

export function RecoveryRedirect() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash.includes("type=recovery")) {
      return;
    }

    const supabase = createNextSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session !== null) {
        window.location.replace("/reset-password");
      }
    });
  }, []);

  return null;
}

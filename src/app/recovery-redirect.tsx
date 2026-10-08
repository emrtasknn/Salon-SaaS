"use client";

import { useEffect } from "react";
import { createNextSupabaseBrowserClient } from "../infrastructure/auth/supabase-browser-client";

export function RecoveryRedirect() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash.includes("type=recovery")) {
      return;
    }

    const supabase = createNextSupabaseBrowserClient();
    let redirected = false;

    const redirectToResetPassword = () => {
      if (redirected) return;
      redirected = true;
      window.location.replace("/reset-password");
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session !== null) {
        redirectToResetPassword();
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session !== null) {
        redirectToResetPassword();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}

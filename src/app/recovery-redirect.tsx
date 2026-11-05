"use client";

import { useEffect } from "react";
import { createNextSupabaseBrowserClient } from "../infrastructure/auth/supabase-browser-client";

export function RecoveryRedirect() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const hash = new URLSearchParams(window.location.hash.slice(1));

    // "recovery" = password reset link; "invite" = staff invite link (no password yet).
    // Both land on the Site URL and must continue to /reset-password to set a password.
    const linkType = hash.get("type");
    if (linkType !== "recovery" && linkType !== "invite") {
      return;
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");

    if (!accessToken || !refreshToken) {
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

    void supabase.auth
      .setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      .then(({ data, error }) => {
        if (error === null && data.session !== null) {
          redirectToResetPassword();
        }
      });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}

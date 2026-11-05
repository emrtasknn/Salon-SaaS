"use client";

import { useEffect } from "react";

/**
 * Navigation only: forwards an already signed-in user from `/` to their area.
 * The destination pages re-check authorization themselves; this grants nothing.
 *
 * It runs client-side on purpose: password-recovery and invite links land on `/`
 * with a `#type=recovery|invite` hash that the server cannot see. A server
 * redirect would carry that hash to the target page (browsers keep the fragment
 * across redirects) and skip RecoveryRedirect, so when such a hash is present
 * this component does nothing and leaves the flow to RecoveryRedirect.
 */
export function EntryRedirect({ target }: { target: string }) {
  useEffect(() => {
    const linkType = new URLSearchParams(window.location.hash.slice(1)).get("type");
    if (linkType === "recovery" || linkType === "invite") return;
    window.location.replace(target);
  }, [target]);

  return (
    <main className="min-h-screen bg-canvas px-4 py-12 sm:py-20">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-large-title text-ink">RandevuN</h1>
        <p role="status" className="mt-1 text-body text-ink-muted">Yönlendiriliyor…</p>
        <a
          href={target}
          className="focus-ring tap-target mt-6 inline-flex items-center text-body font-semibold text-ink underline underline-offset-4"
        >
          Devam et
        </a>
      </div>
    </main>
  );
}

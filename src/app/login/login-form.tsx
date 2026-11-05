"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createNextSupabaseBrowserClient } from "@/infrastructure/auth/supabase-browser-client";

import { buttonPrimary, card, field } from "../_ui/styles";

export function LoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const supabase = createNextSupabaseBrowserClient();

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error !== null) {
        setErrorMessage("E-posta veya şifre hatalı.");
        return;
      }

      const { data } = await supabase.auth.getUser();
      const isSuperAdmin =
        data.user?.app_metadata?.platform_role === "SUPER_ADMIN";

      router.replace(isSuperAdmin ? "/platform/tenants" : "/admin");
      router.refresh();
    } catch {
      setErrorMessage("Giriş sırasında beklenmeyen bir hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasError = errorMessage !== "";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className={`${card} space-y-4`}>
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-subhead font-medium text-ink">E-posta</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={hasError ? "login-error" : undefined}
            className={field}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-subhead font-medium text-ink">Şifre</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={hasError ? "login-error" : undefined}
            className={field}
            required
          />
        </div>
      </div>

      {hasError ? (
        <p
          id="login-error"
          role="alert"
          className="rounded-control border border-destructive/40 bg-status-rejected-bg p-3.5 text-subhead font-medium text-status-rejected"
        >
          {errorMessage}
        </p>
      ) : null}

      <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className={`${buttonPrimary} w-full`}>
        {isSubmitting ? "Giriş yapılıyor..." : "Giriş yap"}
      </button>
    </form>
  );
}

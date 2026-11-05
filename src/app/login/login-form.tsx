"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createNextSupabaseBrowserClient } from "@/infrastructure/auth/supabase-browser-client";

import { card, statusNote } from "../_ui/styles";
import { Button } from "@/components/ui/button";
import { LockKeyhole, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";

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

  const [resetNotice, setResetNotice] = useState("");

  async function handleForgotPassword() {
    setErrorMessage("");
    setResetNotice("");
    if (!email.includes("@")) {
      setErrorMessage("Şifre yenileme için önce e-posta adresinizi yazın.");
      return;
    }
    setIsSubmitting(true);
    try {
      const supabase = createNextSupabaseBrowserClient();
      // The link lands on the site root; RecoveryRedirect then opens /reset-password.
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    } catch {
      // Same message either way: never reveal whether an account exists.
    } finally {
      setIsSubmitting(false);
      setResetNotice("Bu e-posta kayıtlıysa şifre yenileme bağlantısı gönderildi. Gelen kutunuzu kontrol edin.");
    }
  }

  const hasError = errorMessage !== "";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className={`${card} space-y-4`}>
        <Input
          id="email"
          name="email"
          type="email"
          label="E-posta"
          leadingIcon={Mail}
          autoComplete="email"
          value={email}
          onChange={setEmail}
          aria-describedby={hasError ? "login-error" : undefined}
          isRequired
        />

        <Input
          id="password"
          name="password"
          type="password"
          label="Şifre"
          leadingIcon={LockKeyhole}
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          aria-describedby={hasError ? "login-error" : undefined}
          isRequired
        />
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

      {resetNotice ? <p role="status" className={statusNote}>{resetNotice}</p> : null}

      <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} variant="primary" className="w-full">
        {isSubmitting ? "Giriş yapılıyor..." : "Giriş yap"}
      </Button>
      <Button type="button" onClick={handleForgotPassword} disabled={isSubmitting} variant="secondary" className="w-full">
        Şifremi unuttum
      </Button>
    </form>
  );
}

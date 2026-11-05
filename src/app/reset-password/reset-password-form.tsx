"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createNextSupabaseBrowserClient } from "../../infrastructure/auth/supabase-browser-client";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage("Şifre en az 8 karakter olmalıdır.");
      return;
    }

    if (password !== confirmation) {
      setErrorMessage("Şifreler eşleşmiyor.");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createNextSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();

      if (data.session === null) {
        setErrorMessage("Oturum bulunamadı veya bağlantının süresi dolmuş. Giriş ekranından \"Şifremi unuttum\" ile yeni bağlantı isteyin.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });

      if (error !== null) {
        setErrorMessage("Şifre güncellenemedi. Giriş ekranından yeni bir şifre yenileme bağlantısı isteyin.");
        return;
      }

      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch {
      setErrorMessage("Şifre güncellenirken beklenmeyen bir hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink">
          Yeni şifre
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-field-border bg-surface px-3 py-2 text-sm text-ink shadow-sm focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/30"
        />
      </div>

      <div>
        <label htmlFor="confirmation" className="block text-sm font-medium text-ink">
          Yeni şifre tekrar
        </label>
        <input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-field-border bg-surface px-3 py-2 text-sm text-ink shadow-sm focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/30"
        />
      </div>

      {errorMessage !== "" ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-status-rejected-bg p-3 text-sm text-status-rejected">
          {errorMessage}
        </p>
      ) : null}

      <Button type="submit" pending={isSubmitting} className="w-full">
        {isSubmitting ? "Şifre güncelleniyor..." : "Şifreyi güncelle"}
      </Button>
    </form>
  );
}

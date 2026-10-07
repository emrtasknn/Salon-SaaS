"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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
        setErrorMessage("Şifre yenileme oturumu geçersiz veya süresi dolmuş.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });

      if (error !== null) {
        setErrorMessage("Şifre güncellenemedi. Yeni bir recovery bağlantısı isteyin.");
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
        <label htmlFor="password" className="block text-sm font-medium text-zinc-900">
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
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div>
        <label htmlFor="confirmation" className="block text-sm font-medium text-zinc-900">
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
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {errorMessage !== "" ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Şifre güncelleniyor..." : "Şifreyi güncelle"}
      </button>
    </form>
  );
}

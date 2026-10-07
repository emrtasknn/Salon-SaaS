"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createNextSupabaseBrowserClient } from "@/infrastructure/auth/supabase-browser-client";

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

      router.replace("/admin");
      router.refresh();
    } catch {
      setErrorMessage("Giriş sırasında beklenmeyen bir hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="email">E-posta</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>

      <div>
        <label htmlFor="password">Şifre</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      {errorMessage !== "" ? (
        <p role="alert">{errorMessage}</p>
      ) : null}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Giriş yapılıyor..." : "Giriş yap"}
      </button>
    </form>
  );
}
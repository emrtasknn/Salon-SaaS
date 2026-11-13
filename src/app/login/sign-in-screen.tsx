import { ThemeToggle } from "../_ui/theme-toggle";
import { Wordmark } from "@/components/ui/logo";

import { LoginForm } from "./login-form";

/** Shared sign-in layout for `/` (PWA start_url) and `/login`. Presentation only. */
export function SignInScreen() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-12 sm:py-20">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-ink">
          <Wordmark className="h-11" />
        </h1>
        <p className="mt-3 text-body text-ink-muted">Randevularınızı yönetmek için giriş yapın.</p>
        <div className="mt-8">
          <LoginForm />
        </div>
        <div className="mt-10 flex justify-center">
          <ThemeToggle showLabel />
        </div>
      </div>
    </main>
  );
}

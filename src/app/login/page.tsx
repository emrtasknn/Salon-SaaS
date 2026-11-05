import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-12 sm:py-20">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-large-title text-ink">Giriş yap</h1>
        <div className="mt-8">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}

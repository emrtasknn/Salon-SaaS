import { BackLink } from "../_ui/back-link";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-md px-6 pt-4">
        <BackLink href="/login" label="Giriş" />
      </div>
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-6 pb-16 pt-6">
        <p className="text-sm font-medium text-zinc-500">RandevuN</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Yeni şifre belirle</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Hesabın için yeni bir şifre belirle.
        </p>
        <div className="mt-6 rounded-xl border border-zinc-300 bg-white p-5 shadow-sm">
          <ResetPasswordForm />
        </div>
      </section>
    </main>
  );
}

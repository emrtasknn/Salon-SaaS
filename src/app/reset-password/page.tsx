import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-zinc-50">
      <section className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium text-zinc-500">Salon-SaaS</p>
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

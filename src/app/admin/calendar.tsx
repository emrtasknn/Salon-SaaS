"use client";

import { useState, useTransition } from "react";
import {
  listAdminAppointments,
  transitionAdminAppointment,
} from "./calendar-actions";

type Props = {
  initialDate: string;
  initialData: Awaited<ReturnType<typeof listAdminAppointments>>;
};

const labels: Record<string, string> = {
  PENDING: "Bekliyor",
  CONFIRMED: "Onaylandı",
  REJECTED: "Reddedildi",
  CANCELLED: "İptal",
  COMPLETED: "Tamamlandı",
};

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
});

export function AdminCalendar({ initialDate, initialData }: Props) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState(initialData);
  const [busy, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  function refresh(nextDate = date) {
    startTransition(async () => {
      const result = await listAdminAppointments(nextDate);
      setData(result);

      if (result.status === "ok") {
        setFeedback("");
      } else {
        setFeedback(
          result.status === "UNAUTHORIZED"
            ? "Bu alan için yetkiniz yok."
            : "Takvim yüklenemedi.",
        );
      }
    });
  }

  function transition(
    appointmentId: string,
    to: "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED",
  ) {
    startTransition(async () => {
      const result = await transitionAdminAppointment(appointmentId, to);

      const messages: Record<string, string> = {
        CONFIRMED: "Randevu onaylandı.",
        REJECTED: "Randevu reddedildi.",
        CANCELLED: "Randevu iptal edildi.",
        COMPLETED: "Randevu tamamlandı.",
      };

      if (result.status === "updated") {
        setFeedback(messages[to]);
        setData(await listAdminAppointments(date));
      } else if (result.status === "INVALID_TRANSITION") {
        setFeedback(
          "Bu randevu için bu işlem artık geçerli değil. Takvim yenilendi.",
        );
        setData(await listAdminAppointments(date));
      } else if (result.status === "UNAUTHORIZED") {
        setFeedback("Bu işlem için yetkiniz yok.");
      } else if (result.status === "NOT_FOUND") {
        setFeedback("Randevu bulunamadı. Takvim yenilendi.");
        setData(await listAdminAppointments(date));
      } else {
        setFeedback("İşlem gerçekleştirilemedi.");
      }
    });
  }

  if (data.status === "UNAUTHORIZED") {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">Yetkisiz erişim</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Bu alan yalnızca işletme yöneticilerine açıktır.
        </p>
      </main>
    );
  }

  const appointments = data.status === "ok" ? data.appointments : [];

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-500">Salon-SaaS</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Randevu takvimi
            </h1>
          </div>

          <div className="flex gap-2">
            <input
              aria-label="Tarih"
              type="date"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                refresh(event.target.value);
              }}
              className="rounded-lg border bg-white px-3 py-2 text-sm"
            />

            <button
              onClick={() => refresh()}
              disabled={busy}
              className="rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "Yükleniyor…" : "Yenile"}
            </button>
          </div>
        </header>

        {feedback && (
          <p
            role="status"
            className="mb-4 rounded-lg border bg-white p-3 text-sm"
          >
            {feedback}
          </p>
        )}

        {appointments.length === 0 ? (
          <div className="rounded-xl border bg-white p-8 text-center text-sm text-zinc-500">
            Bu gün için randevu yok.
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((appointment) => (
              <article
                key={appointment.id}
                className="rounded-xl border bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {timeFormatter.format(new Date(appointment.startAt))}–
                      {timeFormatter.format(new Date(appointment.endAt))}
                    </p>

                    <p className="mt-2 text-sm text-zinc-700">
                      <span className="font-medium">Personel:</span>{" "}
                      {appointment.staffDisplayName}
                    </p>

                    <p className="text-sm text-zinc-700">
                      <span className="font-medium">Müşteri:</span>{" "}
                      {appointment.customerDisplayName}
                    </p>

                    <p className="text-sm text-zinc-700">
                      <span className="font-medium">Hizmet:</span>{" "}
                      {appointment.serviceName}
                    </p>
                  </div>

                  <span className="rounded-full border px-2 py-1 text-xs">
                    {labels[appointment.status] ?? appointment.status}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {appointment.status === "PENDING" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => transition(appointment.id, "CONFIRMED")}
                        className="rounded-lg bg-black px-3 py-2 text-xs text-white disabled:opacity-50"
                      >
                        Onayla
                      </button>

                      <button
                        disabled={busy}
                        onClick={() => transition(appointment.id, "REJECTED")}
                        className="rounded-lg border border-red-300 px-3 py-2 text-xs text-red-700 disabled:opacity-50"
                      >
                        Reddet
                      </button>
                    </>
                  )}

                  {appointment.status === "CONFIRMED" && (
                    <button
                      disabled={busy}
                      onClick={() => transition(appointment.id, "COMPLETED")}
                      className="rounded-lg bg-black px-3 py-2 text-xs text-white disabled:opacity-50"
                    >
                      Tamamlandı
                    </button>
                  )}

                  {(appointment.status === "PENDING" ||
                    appointment.status === "CONFIRMED") && (
                    <button
                      disabled={busy}
                      onClick={() => transition(appointment.id, "CANCELLED")}
                      className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50"
                    >
                      İptal et
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

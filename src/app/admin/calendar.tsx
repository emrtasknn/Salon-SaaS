"use client";

import { useRef, useState, useTransition } from "react";
import {
  createAdminAppointment,
  getAdminCreateOptions,
  listAdminAppointments,
  listAdminSlots,
  searchAdminCustomers,
  transitionAdminAppointment,
} from "./calendar-actions";
import { CreateAppointmentDialog } from "../create-appointment-dialog";
import { BookingContactSummary } from "../booking-contact-summary";
import {
  AppointmentSheet,
  DateStepper,
  DayTimeline,
  DetailList,
  formatTimeRange,
  useCalendarView,
  ViewSwitch,
} from "../_ui/day-timeline";
import { appointmentStatusBadge, badgeBase, buttonDestructiveOutline, buttonPrimary, buttonSecondary } from "../_ui/styles";

type AdminTransitionTarget = "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED";
type ActionKind = "primary" | "destructive" | "secondary";

/** Same actions per status as the list always offered; the server re-validates every transition. */
function availableActions(status: string): Array<{ to: AdminTransitionTarget; label: string; kind: ActionKind }> {
  if (status === "PENDING") {
    return [
      { to: "CONFIRMED", label: "Onayla", kind: "primary" },
      { to: "REJECTED", label: "Reddet", kind: "destructive" },
      { to: "CANCELLED", label: "İptal et", kind: "secondary" },
    ];
  }
  if (status === "CONFIRMED") {
    return [
      { to: "COMPLETED", label: "Tamamlandı", kind: "primary" },
      { to: "CANCELLED", label: "İptal et", kind: "secondary" },
    ];
  }
  return [];
}

const listActionClass: Record<ActionKind, string> = {
  primary: "rounded-lg bg-black px-3 py-2 text-xs text-white disabled:opacity-50",
  destructive: "rounded-lg border border-red-300 px-3 py-2 text-xs text-red-700 disabled:opacity-50",
  secondary: "rounded-lg border px-3 py-2 text-xs disabled:opacity-50",
};

const sheetActionClass: Record<ActionKind, string> = {
  primary: buttonPrimary,
  destructive: buttonDestructiveOutline,
  secondary: buttonSecondary,
};

const createVariant = {
  kind: "admin",
  loadOptions: getAdminCreateOptions,
  listSlots: listAdminSlots,
  searchCustomers: searchAdminCustomers,
  create: createAdminAppointment,
} as const;

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
  const [view, setView] = useCalendarView();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sheetTrigger = useRef<HTMLElement | null>(null);

  function changeDate(nextDate: string) {
    setSelectedId(null);
    setDate(nextDate);
    refresh(nextDate);
  }

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

  function onCreated(created: { date: string; notified: boolean }) {
    setDate(created.date);
    startTransition(async () => {
      const result = await listAdminAppointments(created.date);
      setData(result);
      setFeedback(
        created.notified
          ? "Randevu oluşturuldu ve onaylandı. Müşteri bildirimi gönderime alındı."
          : "Randevu oluşturuldu ve onaylandı.",
      );
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
  const selected = selectedId ? appointments.find((a) => a.id === selectedId) ?? null : null;

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

          <div className="flex flex-wrap gap-2">
            <CreateAppointmentDialog
              variant={createVariant}
              initialDate={date}
              onCreated={onCreated}
            />
            <DateStepper date={date} onChange={changeDate} disabled={busy}>
              <input
                aria-label="Tarih"
                type="date"
                value={date}
                onChange={(event) => {
                  if (event.target.value) changeDate(event.target.value);
                }}
                className="min-h-11 rounded-lg border bg-white px-3 py-2 text-sm tabular-nums"
              />
            </DateStepper>

            <button
              onClick={() => refresh()}
              disabled={busy}
              className="min-h-11 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "Yükleniyor…" : "Yenile"}
            </button>
          </div>
        </header>

        <div className="mb-4">
          <ViewSwitch view={view} onChange={setView} />
        </div>

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
        ) : view === "timeline" ? (
          <DayTimeline
            date={date}
            rows={staffRows(appointments)}
            items={appointments.map((a) => ({
              id: a.id,
              rowId: a.staffId,
              startAt: a.startAt,
              endAt: a.endAt,
              status: a.status,
              customer: a.bookingContact?.displayName ?? a.customerDisplayName,
              service: a.serviceName,
            }))}
            onSelect={(id, trigger) => {
              sheetTrigger.current = trigger;
              setSelectedId(id);
            }}
          />
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

                    <BookingContactSummary
                      contact={appointment.bookingContact}
                      profile={{ displayName: appointment.customerDisplayName }}
                    />
                  </div>

                  <span className="rounded-full border px-2 py-1 text-xs">
                    {labels[appointment.status] ?? appointment.status}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {availableActions(appointment.status).map((action) => (
                    <button
                      key={action.to}
                      disabled={busy}
                      onClick={() => transition(appointment.id, action.to)}
                      className={listActionClass[action.kind]}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <AppointmentSheet
        open={selected !== null}
        title={selected ? formatTimeRange(selected.startAt, selected.endAt) : ""}
        onClose={() => {
          setSelectedId(null);
          sheetTrigger.current?.focus();
        }}
      >
        {selected && (
          <div className="space-y-4">
            <span className={`${badgeBase} ${appointmentStatusBadge[selected.status] ?? "bg-surface-muted text-ink"}`}>
              {labels[selected.status] ?? selected.status}
            </span>
            <DetailList
              entries={[
                { label: "Müşteri", value: selected.customerDisplayName },
                { label: "Hizmet", value: selected.serviceName },
                { label: "Personel", value: selected.staffDisplayName },
              ]}
            />
            <BookingContactSummary
              contact={selected.bookingContact}
              profile={{ displayName: selected.customerDisplayName }}
            />
            {feedback && (
              <p role="status" className="text-subhead text-ink">
                {feedback}
              </p>
            )}
            {availableActions(selected.status).length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {availableActions(selected.status).map((action) => (
                  <button
                    key={action.to}
                    type="button"
                    disabled={busy}
                    onClick={() => transition(selected.id, action.to)}
                    className={`${sheetActionClass[action.kind]} sm:flex-1`}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-subhead text-ink-muted">Bu randevu için başka işlem yok.</p>
            )}
          </div>
        )}
      </AppointmentSheet>
    </main>
  );
}

/** One row per staff member who has appointments that day (the loader returns appointments only). */
function staffRows(appointments: ReadonlyArray<{ staffId: string; staffDisplayName: string }>) {
  const rows = new Map<string, string>();
  for (const appointment of appointments) rows.set(appointment.staffId, appointment.staffDisplayName);
  return [...rows].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "tr-TR"));
}

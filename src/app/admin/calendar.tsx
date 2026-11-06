"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  createAdminAppointment,
  getAdminCreateOptions,
  listAdminAppointments,
  listAdminSlots,
  rescheduleAdminAppointment,
  searchAdminCustomers,
  transitionAdminAppointment,
} from "./calendar-actions";
import { MoveStepButtons, useAppointmentMove } from "../_ui/appointment-move";
import { CreateAppointmentDialog } from "../create-appointment-dialog";
import { BookingContactSummary } from "../booking-contact-summary";
import {
  AppointmentSheet,
  DateStepper,
  DayTimeline,
  DetailList,
  formatPeriod,
  formatTimeRange,
  useMinuteClock,
  useCalendarData,
  useCalendarView,
  ViewSwitch,
} from "../_ui/day-timeline";
import { WeekView } from "../_ui/week-view";
import { MonthView } from "../_ui/month-view";
import { dateInZone, TIMELINE_TIME_ZONE } from "../_ui/timeline-layout";
import { formatDayLabel } from "../_ui/date-format";
import { ConfirmButton } from "../_ui/confirm-button";
import { appointmentStatusBadge, badgeBase, fieldInline, appointmentStatusLabel } from "../_ui/styles";
import { PageHeader } from "../_ui/page-header";
import { AdminClosures } from "./closures";
import type { ClosureListResult, LocalDateIso } from "../appointment-create-contract";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { RotateCw } from "lucide-react";

type AdminTransitionTarget = "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED";
type ActionKind = "primary" | "destructive" | "secondary";

/**
 * Actions per status; the server re-validates every transition. "Tamamlandı" appears only once the
 * appointment has started (owner decision 2026-11-06; the server also refuses with NOT_STARTED).
 */
function availableActions(
  appointment: Readonly<{ status: string; startAt: string | Date }>,
  nowMs: number | null,
): Array<{ to: AdminTransitionTarget; label: string; kind: ActionKind }> {
  const status = appointment.status;
  if (status === "PENDING") {
    return [
      { to: "CONFIRMED", label: "Onayla", kind: "primary" },
      { to: "REJECTED", label: "Reddet", kind: "destructive" },
      { to: "CANCELLED", label: "İptal et", kind: "secondary" },
    ];
  }
  if (status === "CONFIRMED") {
    const started = nowMs !== null && new Date(appointment.startAt).getTime() <= nowMs;
    return [
      ...(started ? [{ to: "COMPLETED" as const, label: "Tamamlandı", kind: "primary" as const }] : []),
      { to: "CANCELLED", label: "İptal et", kind: "secondary" },
    ];
  }
  return [];
}

/** Irreversible transitions ask first (ConfirmButton); the copy stays honest about notifications. */
const confirmCopy: Partial<Record<AdminTransitionTarget, { question: string; confirmLabel: string }>> = {
  REJECTED: { question: "Talep reddedilsin mi?", confirmLabel: "Evet, reddet" },
  CANCELLED: { question: "Randevu iptal edilsin mi?", confirmLabel: "Evet, iptal et" },
};
const CONFIRM_DETAIL = "Bu işlem geri alınamaz. Müşteri bildirim izni verdiyse bilgilendirilir.";

const actionVariant: Record<ActionKind, ButtonVariant> = {
  primary: "primary",
  destructive: "danger-outline",
  secondary: "secondary",
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
  closures: Readonly<{ initialData: ClosureListResult; range: Readonly<{ from: LocalDateIso; to: LocalDateIso }> }>;
  /** Notification bell, rendered in the fixed top layer. */
  bell?: ReactNode;
  /** Appointment to open on load (deep link from a notification); UI selection only. */
  initialSelectedId?: string | null;
};

const timeFormatter = new Intl.DateTimeFormat("tr-TR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIMELINE_TIME_ZONE,
});

export function AdminCalendar({ initialDate, initialData, closures, bell, initialSelectedId = null }: Props) {
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useCalendarView();
  const { data, stale, busy: loading, refresh } = useCalendarData(listAdminAppointments, view, date, {
    startDate: initialDate,
    endDate: initialDate,
    data: initialData,
  });
  const [acting, startTransition] = useTransition();
  const busy = loading || acting;
  const [feedback, setFeedback] = useState("");
  const nowMs = useMinuteClock();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [closuresOpen, setClosuresOpen] = useState(false);
  const move = useAppointmentMove({
    reschedule: rescheduleAdminAppointment,
    onDone: (message) => {
      setFeedback(message);
      refresh();
    },
  });
  const [closureData, setClosureData] = useState(closures.initialData);
  const sheetTrigger = useRef<HTMLElement | null>(null);
  const closuresTrigger = useRef<HTMLButtonElement | null>(null);

  const closedDates = useMemo(
    () => new Set(closureData.status === "OK" ? closureData.closures.map((closure) => closure.date) : []),
    [closureData],
  );

  function changeDate(nextDate: string) {
    setSelectedId(null);
    setFeedback("");
    setDate(nextDate);
  }

  function openDay(nextDate: string) {
    changeDate(nextDate);
    setView("day");
  }

  function onCreated(created: { date: string; notified: boolean }) {
    setDate(created.date);
    refresh();
    setFeedback(
      created.notified
        ? "Randevu oluşturuldu ve onaylandı. Müşteri bildirimi gönderime alındı."
        : "Randevu oluşturuldu ve onaylandı.",
    );
  }

  function transition(
    appointmentId: string,
    to: "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED",
  ) {
    // Immediate tick inside the tap (iOS only allows haptics there); outcome pattern after the result.
    haptic(to === "REJECTED" || to === "CANCELLED" ? "warning" : "selection");
    startTransition(async () => {
      const result = await transitionAdminAppointment(appointmentId, to);
      haptic(result.status === "updated" ? (to === "CONFIRMED" || to === "COMPLETED" ? "success" : "light") : "error");

      const messages: Record<string, string> = {
        CONFIRMED: "Randevu onaylandı.",
        REJECTED: "Randevu reddedildi.",
        CANCELLED: "Randevu iptal edildi.",
        COMPLETED: "Randevu tamamlandı.",
      };

      if (result.status === "updated") {
        setFeedback(messages[to]);
        refresh();
      } else if (result.status === "INVALID_TRANSITION") {
        setFeedback(
          "Bu randevu için bu işlem artık geçerli değil. Takvim yenilendi.",
        );
        refresh();
      } else if (result.status === "NOT_STARTED") {
        setFeedback("Randevu başlamadan tamamlandı olarak işaretlenemez.");
      } else if (result.status === "UNAUTHORIZED") {
        setFeedback("Bu işlem için yetkiniz yok.");
      } else if (result.status === "NOT_FOUND") {
        setFeedback("Randevu bulunamadı. Takvim yenilendi.");
        refresh();
      } else {
        setFeedback("İşlem gerçekleştirilemedi.");
      }
    });
  }

  if (data.status === "UNAUTHORIZED") {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">Yetkisiz erişim</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Bu alan yalnızca işletme yöneticilerine açıktır.
        </p>
      </main>
    );
  }

  const appointments = data.status === "ok" ? data.appointments : [];
  const loadError = data.status !== "ok" ? "Takvim yüklenemedi." : "";
  // Day and list show only the anchor date (data may still hold a wider range while reloading).
  const dayAppointments = appointments.filter((a) => dateInZone(a.startAt) === date);
  const movableOf = (a: (typeof appointments)[number]) => ({
    id: a.id,
    startAt: a.startAt,
    endAt: a.endAt,
    title: a.bookingContact?.displayName ?? a.customerDisplayName,
    detail: `${a.serviceName} · ${a.staffDisplayName}`,
  });
  const selected = selectedId ? appointments.find((a) => a.id === selectedId) ?? null : null;
  const select = (id: string, trigger: HTMLElement) => {
    sheetTrigger.current = trigger;
    setFeedback("");
    setSelectedId(id);
  };

  return (
    <main className="min-h-screen bg-canvas">
      <PageHeader
        title="Randevu takvimi"
        eyebrow={<span aria-live="polite">{formatPeriod(view, date)}</span>}
        accessory={bell}
        widthClassName="max-w-5xl"
      >
        <ViewSwitch
          view={view}
          onChange={(next) => {
            setSelectedId(null);
            setView(next);
          }}
        />
        <DateStepper date={date} view={view} onChange={changeDate} disabled={busy}>
          <input
            aria-label="Tarih"
            type="date"
            value={date}
            onChange={(event) => {
              if (event.target.value) changeDate(event.target.value);
            }}
            className={`${fieldInline} tabular-nums`}
          />
        </DateStepper>
      </PageHeader>
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          <CreateAppointmentDialog
            variant={createVariant}
            initialDate={date}
            onCreated={onCreated}
          />
          <Button
            ref={closuresTrigger}
            type="button"
            onClick={() => setClosuresOpen(true)}
            variant="secondary"
          >
            Kapalı günler
          </Button>
          <Button
            type="button"
            onClick={() => refresh()}
            disabled={busy}
            variant="secondary"
            leadingIcon={RotateCw}
            aria-label={loading ? "Yükleniyor" : "Yenile"}
            className="ml-auto px-3 sm:px-4"
          >
            <span className="sr-only sm:not-sr-only">{loading ? "Yükleniyor…" : "Yenile"}</span>
          </Button>
        </div>

        {(feedback || loadError) && (
          <p
            role="status"
            className="mb-4 rounded-control border border-separator bg-surface p-3.5 text-subhead text-ink"
          >
            {feedback || loadError}
          </p>
        )}

        <div aria-busy={stale} className={stale ? "opacity-60 transition-opacity duration-150" : undefined}>
        {view === "month" ? (
          <MonthView date={date} items={appointments} closedDates={closedDates} onOpenDay={openDay} />
        ) : view === "week" ? (
          <WeekView
            date={date}
            perStaffColors
            items={appointments.map((a) => ({
              id: a.id,
              staffId: a.staffId,
              staffName: a.staffDisplayName,
              startAt: a.startAt,
              endAt: a.endAt,
              status: a.status,
              customer: a.bookingContact?.displayName ?? a.customerDisplayName,
              service: a.serviceName,
            }))}
            onSelect={select}
            onOpenDay={openDay}
          />
        ) : dayAppointments.length === 0 ? (
          <div className="inset-group p-8 text-center text-body text-ink-muted">
            {closedDates.has(date) ? "Bu gün kapalı gün olarak işaretli. Randevu yok." : "Bu gün için randevu yok."}
          </div>
        ) : view === "day" ? (
          <DayTimeline
            date={date}
            rows={staffRows(dayAppointments)}
            items={dayAppointments.map((a) => move.preview({
              id: a.id,
              rowId: a.staffId,
              startAt: a.startAt,
              endAt: a.endAt,
              status: a.status,
              customer: a.bookingContact?.displayName ?? a.customerDisplayName,
              service: a.serviceName,
            }))}
            onSelect={select}
            pendingId={move.pendingId}
            onMove={(id, deltaMinutes) => {
              const a = dayAppointments.find((candidate) => candidate.id === id);
              if (a) move.propose(movableOf(a), deltaMinutes);
            }}
          />
        ) : (
          <div className="space-y-3">
            {dayAppointments.map((appointment) => (
              <article
                key={appointment.id}
                className="rounded-xl border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {timeFormatter.format(new Date(appointment.startAt))}–
                      {timeFormatter.format(new Date(appointment.endAt))}
                    </p>

                    <p className="mt-2 text-sm text-ink-muted">
                      <span className="font-medium">Personel:</span>{" "}
                      {appointment.staffDisplayName}
                    </p>

                    <p className="text-sm text-ink-muted">
                      <span className="font-medium">Müşteri:</span>{" "}
                      {appointment.customerDisplayName}
                    </p>

                    <p className="text-sm text-ink-muted">
                      <span className="font-medium">Hizmet:</span>{" "}
                      {appointment.serviceName}
                    </p>

                    <BookingContactSummary
                      contact={appointment.bookingContact}
                      profile={{ displayName: appointment.customerDisplayName }}
                    />
                  </div>

                  <span className="rounded-full border px-2 py-1 text-xs">
                    {appointmentStatusLabel[appointment.status] ?? appointment.status}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {availableActions(appointment, nowMs).map((action) => {
                    const ask = confirmCopy[action.to];
                    return ask ? (
                      <ConfirmButton
                        key={action.to}
                        label={action.label}
                        question={ask.question}
                        detail={CONFIRM_DETAIL}
                        confirmLabel={ask.confirmLabel}
                        size="small"
                        variant={actionVariant[action.kind]}
                        disabled={busy}
                        onConfirm={() => transition(appointment.id, action.to)}
                      />
                    ) : (
                      <Button
                        key={action.to}
                        type="button"
                        size="small"
                        variant={actionVariant[action.kind]}
                        disabled={busy}
                        onClick={() => transition(appointment.id, action.to)}
                      >
                        {action.label}
                      </Button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
        </div>
      </div>

      <AppointmentSheet
        open={selected !== null}
        title={selected ? `${formatDayLabel(selected.startAt)} · ${formatTimeRange(selected.startAt, selected.endAt)}` : ""}
        onClose={() => {
          setSelectedId(null);
          sheetTrigger.current?.focus();
        }}
      >
        {selected && (
          <div className="space-y-4">
            <span className={`${badgeBase} ${appointmentStatusBadge[selected.status] ?? "bg-surface-muted text-ink"}`}>
              {appointmentStatusLabel[selected.status] ?? selected.status}
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
            {(selected.status === "PENDING" || selected.status === "CONFIRMED") && (
              <MoveStepButtons
                disabled={busy || move.saving}
                onStep={(deltaMinutes) => {
                  const target = selected;
                  setSelectedId(null);
                  move.propose(movableOf(target), deltaMinutes);
                }}
              />
            )}
            {availableActions(selected, nowMs).length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {availableActions(selected, nowMs).map((action) => {
                  const ask = confirmCopy[action.to];
                  return ask ? (
                    <ConfirmButton
                      key={action.to}
                      label={action.label}
                      question={ask.question}
                      detail={CONFIRM_DETAIL}
                      confirmLabel={ask.confirmLabel}
                      variant={actionVariant[action.kind]}
                      disabled={busy}
                      onConfirm={() => transition(selected.id, action.to)}
                      className="sm:flex-1"
                    />
                  ) : (
                    <Button
                      key={action.to}
                      type="button"
                      variant={actionVariant[action.kind]}
                      disabled={busy}
                      onClick={() => transition(selected.id, action.to)}
                      className="sm:flex-1"
                    >
                      {action.label}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="text-subhead text-ink-muted">Bu randevu için başka işlem yok.</p>
            )}
          </div>
        )}
      </AppointmentSheet>

      {move.sheet}

      <AppointmentSheet
        wide
        open={closuresOpen}
        title="Kapalı günler"
        onClose={() => {
          setClosuresOpen(false);
          closuresTrigger.current?.focus();
        }}
      >
        <AdminClosures
          embedded
          initialData={closureData}
          initialRange={closures.range}
          onDataChange={setClosureData}
        />
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

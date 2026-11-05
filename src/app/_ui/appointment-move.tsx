"use client";

import { useState, useTransition } from "react";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import type { RescheduleView } from "../appointment-create-runtime";
import { AppointmentSheet, formatTimeRange, MOVE_STEP_MINUTES } from "./day-timeline";

/*
 * Drag-to-move flow shared by the admin and staff day calendars (owner decision 2026-11-05):
 * drop → confirmation sheet → server action. While the sheet is open the block is previewed at the
 * new time; Vazgeç or an error springs it back. The server re-checks scope, slot and conflicts.
 */

type Movable = Readonly<{ id: string; startAt: Date | string; endAt: Date | string; title: string; detail: string }>;
type PendingMove = Readonly<{ item: Movable; deltaMinutes: number }>;

const shift = (value: Date | string, minutes: number) => new Date(new Date(value).getTime() + minutes * 60_000);

const errorText: Record<string, string> = {
  SLOT_UNAVAILABLE: "Bu saat dolu ya da çalışma saatleri dışında. Randevu yerinde bırakıldı.",
  CLOSED_DATE: "Bu gün kapalı gün olarak işaretli. Randevu yerinde bırakıldı.",
  STALE: "Randevu bu sırada değişti. Takvim yenilendi.",
  INVALID_STATUS: "Bu randevu artık taşınamaz.",
  FORBIDDEN: "Bu randevuyu taşıma yetkiniz yok.",
  NOT_FOUND: "Randevu bulunamadı. Takvim yenilendi.",
  TENANT_INACTIVE: "Salon pasif durumda; randevu taşınamaz.",
};

export function useAppointmentMove({
  reschedule,
  onDone,
}: {
  reschedule: (appointmentId: string, newStartAtIso: string) => Promise<RescheduleView>;
  /** Called with a status line after the server answered (refresh the calendar there). */
  onDone: (message: string, ok: boolean) => void;
}) {
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [saving, startSaving] = useTransition();

  /** Applies the pending preview to a calendar item (same shape back). */
  function preview<T extends { id: string; startAt: Date | string; endAt: Date | string }>(item: T): T {
    if (!pending || pending.item.id !== item.id) return item;
    return { ...item, startAt: shift(item.startAt, pending.deltaMinutes), endAt: shift(item.endAt, pending.deltaMinutes) };
  }

  function propose(item: Movable, deltaMinutes: number) {
    if (deltaMinutes !== 0) setPending({ item, deltaMinutes });
  }

  function cancel() {
    if (saving) return;
    setPending(null);
  }

  function confirm() {
    if (!pending) return;
    const { item, deltaMinutes } = pending;
    haptic("selection");
    startSaving(async () => {
      let result: RescheduleView;
      try {
        result = await reschedule(item.id, shift(item.startAt, deltaMinutes).toISOString());
      } catch {
        result = { status: "PERSISTENCE_FAILURE" };
      }
      setPending(null);
      if (result.status === "RESCHEDULED") {
        haptic("success");
        const notice = result.notified
          ? "Müşteriye WhatsApp ile bildirildi."
          : "Müşteriye otomatik bildirim ulaşmadı; gerekirse siz haber verin.";
        onDone(`Randevu ${formatTimeRange(result.startAt, result.endAt)} saatine taşındı. ${notice}`, true);
      } else {
        haptic("error");
        onDone(errorText[result.status] ?? "Randevu taşınamadı. Lütfen tekrar deneyin.", false);
      }
    });
  }

  const sheet = (
    <AppointmentSheet open={pending !== null} title="Randevuyu taşı" onClose={cancel}>
      {pending ? (
        <div className="space-y-4">
          <p className="text-body text-ink">
            <span className="font-semibold">{pending.item.title}</span> · {pending.item.detail}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-headline tabular-nums" aria-live="polite">
            <span className="text-ink-muted line-through">{formatTimeRange(pending.item.startAt, pending.item.endAt)}</span>
            <ArrowRight className="size-5 text-ink-muted" aria-hidden />
            <span>{formatTimeRange(shift(pending.item.startAt, pending.deltaMinutes), shift(pending.item.endAt, pending.deltaMinutes))}</span>
          </p>
          <p className="text-subhead text-ink-muted">
            WhatsApp bildirimine izin veren müşteriye yeni saat otomatik bildirilir. Bildirim ulaşmazsa taşıma sonrası size söyleriz.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" pending={saving} onClick={confirm} className="sm:flex-1">
              Taşı
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={cancel} className="sm:flex-1">
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}
    </AppointmentSheet>
  );

  return { pendingId: pending?.item.id ?? null, preview, propose, sheet, saving };
}

/** Keyboard/screen-reader path to the same move: ±15 min buttons inside the detail sheet. */
export function MoveStepButtons({ onStep, disabled }: { onStep: (deltaMinutes: number) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Saati değiştir">
      <span className="text-subhead text-ink-muted">Saati değiştir</span>
      <Button type="button" variant="secondary" size="small" leadingIcon={ChevronUp} disabled={disabled} onClick={() => onStep(-MOVE_STEP_MINUTES)}>
        {MOVE_STEP_MINUTES} dk erken
      </Button>
      <Button type="button" variant="secondary" size="small" leadingIcon={ChevronDown} disabled={disabled} onClick={() => onStep(MOVE_STEP_MINUTES)}>
        {MOVE_STEP_MINUTES} dk geç
      </Button>
    </div>
  );
}

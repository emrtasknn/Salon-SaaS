"use client";

import { useState } from "react";
import { TimeSelect } from "../../_ui/time-select";
import { formatHoursRange, timeToMinutes } from "../../_ui/time-of-day";
import { switchClassName } from "../../_ui/styles";
import { removeWorkingHoursAction, saveWorkingHoursAction } from "../actions";
import { AdminSubpage, AdminUnauthorized, message, useAdminData, type AdminData } from "../admin-management";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { planHoursChanges, type DayDraft } from "./hours-plan";

// Index = dayOfWeek (0 = Pazar), matching the server contract.
const days = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
// Monday-first display order; dayOfWeek values are unchanged.
const displayOrder = [1, 2, 3, 4, 5, 6, 0];

const INVALID_HOURS = "Çalışma saatlerini kontrol edin (kapanış en geç 23:59 olmalı).";

export function WorkingHoursEditor({ initialData }: { initialData: AdminData }) {
  const { data, busy, startTransition, feedback, setFeedback, refresh } = useAdminData(initialData);
  const hours = data.status !== "UNAUTHORIZED" && data.workingHours.status === "listed" ? data.workingHours.workingHours : [];
  // Which days are switched open in the draft; starts from the saved week.
  const [openDays, setOpenDays] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(days.map((_, index) => [index, hours.some((item) => item.dayOfWeek === index)])),
  );
  // Bumped after a save so the time selects re-read the saved values.
  const [version, setVersion] = useState(0);

  if (data.status === "UNAUTHORIZED") return <AdminUnauthorized />;

  function save(formData: FormData) {
    const drafts: DayDraft[] = days.map((_, index) => ({
      dayOfWeek: index,
      open: openDays[index] ?? false,
      openMinute: timeToMinutes(String(formData.get(`openTime-${index}`) ?? "")),
      closeMinute: timeToMinutes(String(formData.get(`closeTime-${index}`) ?? "")),
    }));
    const plan = planHoursChanges(hours, drafts);
    if (plan.status === "invalid") {
      haptic("error");
      setFeedback(`${days[plan.dayOfWeek]}: kapanış saati açılıştan sonra olmalı.`);
      return;
    }
    if (plan.changes.length === 0) {
      setFeedback("Değişiklik yok.");
      return;
    }
    startTransition(async () => {
      // Existing per-day actions, one after another; the server validates each day.
      const failed: string[] = [];
      let lastError = "";
      for (const change of plan.changes) {
        const result =
          change.kind === "save"
            ? await saveWorkingHoursAction({ dayOfWeek: change.dayOfWeek, openMinute: change.openMinute, closeMinute: change.closeMinute })
            : await removeWorkingHoursAction(change.dayOfWeek);
        const ok = result.status === "created" || result.status === "updated" || result.status === "removed";
        if (!ok) {
          failed.push(days[change.dayOfWeek]);
          lastError = result.status === "INVALID_INPUT" ? INVALID_HOURS : message(result.status);
        }
      }
      if (failed.length) {
        haptic("error");
        setFeedback(`${failed.join(", ")} kaydedilemedi. ${lastError}`);
      } else {
        haptic("success");
        setFeedback("Çalışma saatleri kaydedildi.");
      }
      setVersion((value) => value + 1);
      refresh();
    });
  }

  return (
    <AdminSubpage title="Çalışma saatleri" feedback={feedback}>
      <form
        aria-labelledby="hours-title"
        onSubmit={(event) => {
          event.preventDefault();
          save(new FormData(event.currentTarget));
        }}
        className="space-y-3"
      >
        <h2 id="hours-title" className="group-label">Haftalık saatler</h2>
        <ul className="inset-group">
          {displayOrder.map((index) => {
            const day = days[index];
            const item = hours.find((value) => value.dayOfWeek === index);
            const open = openDays[index] ?? false;
            return (
              <li key={day} className="inset-row p-4">
                <label className="flex min-h-11 items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-headline">{day}</span>
                    <span className="block text-footnote tabular-nums text-ink-muted">
                      {item ? `Kayıtlı: ${formatHoursRange(item.openMinute, item.closeMinute)}` : "Kayıtlı: Kapalı"}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={open}
                    aria-label={`${day} açık`}
                    checked={open}
                    disabled={busy}
                    onChange={(event) => {
                      haptic("selection");
                      setOpenDays((current) => ({ ...current, [index]: event.target.checked }));
                    }}
                    className={switchClassName}
                  />
                </label>
                {open ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <TimeSelect
                      key={`open-${index}-${item?.openMinute ?? "new"}-${version}`}
                      name={`openTime-${index}`}
                      label={`${day} açılış`}
                      legend="Açılış"
                      defaultMinute={item?.openMinute ?? 540}
                      required
                      disabled={busy}
                    />
                    <TimeSelect
                      key={`close-${index}-${item?.closeMinute ?? "new"}-${version}`}
                      name={`closeTime-${index}`}
                      label={`${day} kapanış`}
                      legend="Kapanış"
                      defaultMinute={item?.closeMinute ?? 1080}
                      required
                      disabled={busy}
                    />
                  </div>
                ) : (
                  <p className="mt-1 text-subhead text-ink-muted">Kapalı · online randevu alınmaz</p>
                )}
              </li>
            );
          })}
        </ul>
        <Button type="submit" disabled={busy} variant="primary" className="w-full">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </Button>
        <p className="px-4 text-footnote text-ink-muted">Saati olmayan günlerde online randevu alınmaz.</p>
      </form>
    </AdminSubpage>
  );
}

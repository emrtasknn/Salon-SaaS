"use client";

import { TimeSelect } from "../../_ui/time-select";
import { formatHoursRange, timeToMinutes } from "../../_ui/time-of-day";
import { removeWorkingHoursAction, saveWorkingHoursAction } from "../actions";
import { AdminSubpage, AdminUnauthorized, message, useAdminData, type AdminData } from "../admin-management";
import { Button } from "@/components/ui/button";

// Index = dayOfWeek (0 = Pazar), matching the server contract.
const days = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
// Monday-first display order; dayOfWeek values are unchanged.
const displayOrder = [1, 2, 3, 4, 5, 6, 0];

const INVALID_HOURS = "Çalışma saatlerini kontrol edin (kapanış en geç 23:59 olmalı).";

export function WorkingHoursEditor({ initialData }: { initialData: AdminData }) {
  const { data, busy, startTransition, feedback, setFeedback, refresh } = useAdminData(initialData);

  if (data.status === "UNAUTHORIZED") return <AdminUnauthorized />;

  const hours = data.workingHours.status === "listed" ? data.workingHours.workingHours : [];

  return (
    <AdminSubpage title="Çalışma saatleri" feedback={feedback}>
      <section aria-labelledby="hours-title">
        <h2 id="hours-title" className="group-label">Haftalık saatler</h2>
        <ul className="inset-group">
          {displayOrder.map((index) => {
            const day = days[index];
            const item = hours.find((value) => value.dayOfWeek === index);
            const summary = item ? formatHoursRange(item.openMinute, item.closeMinute) : "";
            return (
              <li key={day} className="inset-row p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-headline">{day}</h3>
                  <p className="text-subhead text-ink-muted tabular-nums">{item ? summary || "Ayarlı" : "Kapalı"}</p>
                </div>
                <form
                  className="mt-3 flex flex-wrap items-end gap-2"
                  action={(formData) =>
                    startTransition(async () => {
                      // TimeSelect posts "HH:MM"; the server contract stays in minutes.
                      const openMinute = timeToMinutes(String(formData.get("openTime") ?? ""));
                      const closeMinute = timeToMinutes(String(formData.get("closeTime") ?? ""));
                      if (openMinute === null || closeMinute === null) {
                        setFeedback(INVALID_HOURS);
                        return;
                      }
                      const result = await saveWorkingHoursAction({ dayOfWeek: index, openMinute, closeMinute });
                      setFeedback(result.status === "INVALID_INPUT" ? INVALID_HOURS : message(result.status));
                      if (result.status === "created" || result.status === "updated") refresh();
                    })
                  }
                >
                  <TimeSelect
                    key={`open-${item?.openMinute ?? "new"}`}
                    name="openTime"
                    label={`${day} açılış`}
                    legend="Açılış"
                    defaultMinute={item?.openMinute ?? 540}
                    required
                  />
                  <TimeSelect
                    key={`close-${item?.closeMinute ?? "new"}`}
                    name="closeTime"
                    label={`${day} kapanış`}
                    legend="Kapanış"
                    defaultMinute={item?.closeMinute ?? 1080}
                    required
                  />
                  <div className="flex w-full gap-2 sm:w-auto">
                    <Button type="submit" disabled={busy} variant="primary" className="flex-1 sm:flex-none">
                      Kaydet
                    </Button>
                    {item && (
                      <Button
                        type="button"
                        disabled={busy}
                        variant="secondary" className="flex-1 sm:flex-none"
                        onClick={() =>
                          startTransition(async () => {
                            const result = await removeWorkingHoursAction(index);
                            setFeedback(message(result.status));
                            if (result.status === "removed") refresh();
                          })
                        }
                      >
                        Kapalı yap
                      </Button>
                    )}
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 px-4 text-footnote text-ink-muted">Saati olmayan günlerde online randevu alınmaz.</p>
      </section>
    </AdminSubpage>
  );
}

"use client";

// WP-08: tenant-wide closed dates (owner decision c). A new closure never
// cancels existing appointments (decision d): the admin is warned and must
// confirm explicitly; existing appointments are handled manually.

import { useId, useState, useTransition } from "react";
import type {
  ClosureImpactAppointmentView,
  ClosureListResult,
  ClosureView,
  LocalDateIso,
} from "../appointment-create-contract";
import { formatLocalDate } from "../create-appointment-dialog";
import { createClosure, deleteClosure, listClosures, previewClosureImpact } from "./closure-actions";
import { Button } from "@/components/ui/button";
import { checkboxClassName, field } from "../_ui/styles";
import { haptic } from "@/lib/haptics";

type Props = Readonly<{
  initialData: ClosureListResult;
  initialRange: Readonly<{ from: LocalDateIso; to: LocalDateIso }>;
  /** Rendered inside the calendar's "Kapalı günler" sheet: no own card, the sheet supplies the title. */
  embedded?: boolean;
  /** Called after every reload so the calendar can re-mark closure days. */
  onDataChange?: (data: ClosureListResult) => void;
}>;

const statusLabels: Record<ClosureImpactAppointmentView["status"], string> = {
  PENDING: "Bekliyor",
  CONFIRMED: "Onaylandı",
};

const createErrors: Record<string, string> = {
  DUPLICATE: "Bu tarih zaten kapalı gün olarak kayıtlı.",
  PAST_DATE: "Geçmiş bir tarih kapatılamaz. Bugün veya ileri bir tarih seçin.",
  INVALID_INPUT: "Bilgileri kontrol edin. Açıklama en fazla 200 karakter olabilir.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
};

function todayIn(timeZone: string): LocalDateIso {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}

export function AdminClosures({ initialData, initialRange, embedded = false, onDataChange }: Props) {
  const ids = useId();
  const [data, setData] = useState(initialData);
  const [busy, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<ReadonlyArray<ClosureImpactAppointmentView> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  if (data.status === "FORBIDDEN") return null;

  const timezone = data.status === "OK" ? data.timezone : undefined;
  const today = timezone ? todayIn(timezone) : undefined;
  const closures: ReadonlyArray<ClosureView> =
    data.status === "OK"
      ? [...data.closures].filter((c) => !today || c.date >= today).sort((a, b) => a.date.localeCompare(b.date))
      : [];

  async function reload() {
    try {
      const next = await listClosures(initialRange);
      setData(next);
      onDataChange?.(next);
    } catch {
      setStatus("Kapalı günler yenilenemedi.");
    }
  }

  function resetImpact() {
    setImpact(null);
    setConfirmed(false);
  }

  function save() {
    setFormError("");
    setStatus("");
    if (!date) {
      setFormError("Bir tarih seçin.");
      return;
    }
    if (reason.trim().length > 200) {
      setFormError("Açıklama en fazla 200 karakter olabilir.");
      return;
    }
    startTransition(async () => {
      try {
        let appointments: ReadonlyArray<ClosureImpactAppointmentView>;
        if (impact === null) {
          const preview = await previewClosureImpact(date);
          if (preview.status !== "OK") {
            setFormError(createErrors[preview.status] ?? "Tarih kontrol edilemedi.");
            return;
          }
          appointments = preview.appointments;
          if (appointments.length > 0) {
            setImpact(appointments);
            setConfirmed(false);
            return; // admin must review the list and confirm explicitly
          }
        } else {
          appointments = impact;
          if (appointments.length > 0 && !confirmed) {
            setFormError("Devam etmek için mevcut randevuları gördüğünüzü onaylayın.");
            return;
          }
        }

        const trimmed = reason.trim();
        const result = await createClosure({
          date,
          ...(trimmed ? { reason: trimmed } : {}),
          confirmExistingAppointments: appointments.length > 0 && confirmed,
        });

        if (result.status === "CREATED") {
          setStatus(`${formatLocalDate(result.closure.date)} kapalı gün olarak kaydedildi.`);
          setDate("");
          setReason("");
          resetImpact();
          await reload();
        } else if (result.status === "HAS_APPOINTMENTS") {
          setImpact(result.appointments);
          setConfirmed(false);
          setFormError("Bu tarihte randevu var. Listeyi kontrol edip onaylayın.");
        } else {
          setFormError(createErrors[result.status] ?? "Kapalı gün kaydedilemedi.");
          if (result.status === "DUPLICATE") await reload();
        }
      } catch {
        setFormError("Kapalı gün kaydedilemedi. Tekrar deneyin.");
      }
    });
  }

  function remove(closure: ClosureView) {
    haptic("warning");
    setStatus("");
    startTransition(async () => {
      try {
        const result = await deleteClosure(closure.id);
        setPendingDelete(null);
        if (result.status === "DELETED") setStatus(`${formatLocalDate(closure.date)} artık kapalı gün değil.`);
        else if (result.status === "NOT_FOUND") setStatus("Kapalı gün bulunamadı. Liste yenilendi.");
        else setStatus("Bu işlem için yetkiniz yok.");
        await reload();
      } catch {
        setStatus("Kapalı gün kaldırılamadı. Tekrar deneyin.");
      }
    });
  }

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className={embedded ? "" : "mt-6 rounded-xl border border-separator bg-surface p-5 shadow-sm"}
    >
      <h2 id={`${ids}-title`} className={embedded ? "sr-only" : "text-lg font-semibold"}>
        Kapalı günler
      </h2>
      <p className={`${embedded ? "" : "mt-1 "}max-w-2xl text-sm text-ink-muted`}>
        Kapalı günlerde online ve yeni randevu alınmaz. Mevcut randevular olduğu gibi kalır; bunları ayrıca sizin
        yönetmeniz gerekir.{timezone ? ` Tarihler işletmenin saat dilimine göredir (${timezone}).` : ""}
      </p>

      <p role="status" aria-live="polite" className={status ? "mt-3 rounded-lg border border-separator bg-surface-muted p-3 text-sm" : "sr-only"}>
        {status}
      </p>

      <div className={embedded ? "mt-4 grid gap-6" : "mt-4 grid gap-6 lg:grid-cols-2"}>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <h3 className="text-sm font-semibold">Kapalı gün ekle</h3>
          <div className="space-y-1">
            <label htmlFor={`${ids}-date`} className="text-sm font-medium">
              Tarih
            </label>
            <input
              id={`${ids}-date`}
              type="date"
              min={today}
              value={date}
              required
              onChange={(e) => {
                setDate(e.target.value);
                resetImpact();
                setFormError("");
              }}
              className={field}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${ids}-reason`} className="text-sm font-medium">
              Açıklama (isteğe bağlı)
            </label>
            <input
              id={`${ids}-reason`}
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-describedby={`${ids}-reason-hint`}
              className={field}
            />
            <p id={`${ids}-reason-hint`} className="text-xs text-ink-muted">
              Örn. resmî tatil, bakım. En fazla 200 karakter ({reason.length}/200).
            </p>
          </div>

          {impact && impact.length > 0 && (
            <div className="rounded-lg border border-status-pending/40 bg-status-pending-bg p-3 text-sm text-status-pending">
              <p className="font-medium">
                {formatLocalDate(date)} tarihinde {impact.length} randevu var.
              </p>
              <p className="mt-1">
                Bu randevular iptal edilmez ve olduğu gibi kalır. Müşterilerle iletişime geçip bunları ayrıca yönetmeniz
                gerekir.
              </p>
              <ul className="mt-2 divide-y divide-status-pending/20" aria-label="Bu tarihteki randevular">
                {impact.map((a) => (
                  <li key={a.id} className="py-2">
                    <span className="font-medium">{a.startLabel}</span> · {a.staffName} · {a.customerName} ·{" "}
                    {statusLabels[a.status] ?? a.status}
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className={`${checkboxClassName} mt-0.5`}
                />
                <span>Bu randevuların iptal edilmeyeceğini anladım; günü yine de kapat.</span>
              </label>
            </div>
          )}

          <div role="alert" aria-live="assertive">
            {formError && (
              <p className="rounded-lg border border-destructive/40 bg-status-rejected-bg p-3 text-sm font-medium text-status-rejected">{formError}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={busy || !date || (impact !== null && impact.length > 0 && !confirmed)}
            variant="primary"
          >
            {busy ? "Kontrol ediliyor…" : impact && impact.length > 0 ? "Günü yine de kapat" : "Kapalı gün olarak kaydet"}
          </Button>
        </form>

        <div>
          <h3 className="text-sm font-semibold">Yaklaşan kapalı günler</h3>
          {data.status === "INVALID_INPUT" ? (
            <p className="mt-2 text-sm text-destructive">Kapalı günler yüklenemedi.</p>
          ) : closures.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Yaklaşan kapalı gün yok. Tatil veya bakım günlerini buradan ekleyin.</p>
          ) : (
            <ul className="mt-2 divide-y divide-separator rounded-lg border border-separator">
              {closures.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{formatLocalDate(c.date)}</p>
                    {c.reason && <p className="break-words text-xs text-ink-muted">{c.reason}</p>}
                  </div>
                  {pendingDelete === c.id ? (
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${formatLocalDate(c.date)} kapalı gününü kaldır`}>
                      <span className="text-xs text-ink-muted">Kaldırılsın mı?</span>
                      <Button type="button" disabled={busy} onClick={() => remove(c)} variant="danger-outline" size="small">
                        Evet, kaldır
                      </Button>
                      <Button type="button" disabled={busy} onClick={() => setPendingDelete(null)} variant="secondary" size="small">
                        Vazgeç
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => setPendingDelete(c.id)}
                      aria-label={`${formatLocalDate(c.date)} kapalı gününü kaldır`}
                      variant="secondary"
                    >
                      Kaldır
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

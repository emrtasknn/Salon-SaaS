"use client";

import { appointmentDeleteRule, type AppointmentDeleteActor, type DeleteResult } from "@/domain/deletion";
import type { AppointmentStatus } from "@/domain/appointment";
import type { ButtonSize } from "@/components/ui/button";
import { DeleteButton } from "./delete-button";

/** UI hint only (same rule the server applies): REJECTED/CANCELLED, plus COMPLETED for admins. */
export function canOfferAppointmentDelete(actor: AppointmentDeleteActor, status: string): boolean {
  return appointmentDeleteRule(actor, status as AppointmentStatus) === "ALLOWED";
}

/** Delete trigger for one appointment; renders nothing for statuses the actor cannot delete. */
export function AppointmentDeleteButton({
  actor,
  status,
  appointmentId,
  summary,
  run,
  onDeleted,
  size,
  disabled,
  className,
}: {
  actor: AppointmentDeleteActor;
  status: string;
  appointmentId: string;
  /** Short name for the accessible label, e.g. "Ayşe Yılmaz · Saç kesimi". */
  summary: string;
  run: (appointmentId: string) => Promise<DeleteResult>;
  onDeleted: () => void;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
}) {
  if (!canOfferAppointmentDelete(actor, status)) return null;
  return (
    <DeleteButton
      ariaLabel={`${summary} randevusunu sil`}
      title="Randevu silinsin mi?"
      description="Randevu kaydı silinir. Bu işlem geri alınamaz."
      confirmLabel="Randevuyu sil"
      run={() => run(appointmentId)}
      onDeleted={onDeleted}
      size={size}
      disabled={disabled}
      className={className}
    />
  );
}

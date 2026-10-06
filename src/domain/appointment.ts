export type AppointmentStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED";

export type AppointmentRecord = Readonly<{
  id: string;
  tenantId: string;
  staffId: string;
  serviceId: string;
  customerProfileId: string;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
}>;

const transitions: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
};

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return value === "PENDING" || value === "CONFIRMED" || value === "REJECTED" ||
    value === "CANCELLED" || value === "COMPLETED";
}

export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionAppointmentStatus(
  from: AppointmentStatus,
  to: unknown,
): AppointmentStatus {
  if (!isAppointmentStatus(to) || !canTransitionAppointment(from, to)) {
    throw new TypeError("Invalid appointment transition");
  }
  return to;
}

export function createAppointmentEnd(startAt: Date, durationMinutes: number, bufferMinutes: number): Date {
  if (!(startAt instanceof Date) || Number.isNaN(startAt.getTime())) throw new TypeError("Appointment start is invalid");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1) throw new TypeError("Appointment duration is invalid");
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0) throw new TypeError("Appointment buffer is invalid");
  return new Date(startAt.getTime() + (durationMinutes + bufferMinutes) * 60_000);
}

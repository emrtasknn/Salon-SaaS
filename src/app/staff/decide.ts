"use server";
import { decideStaffAppointment } from "./actions";
import { publishAppointmentNotification } from "../notification-runtime";
import type { NotificationEventType } from "../../domain/notification";

export async function decideAndNotify(appointmentId: string, to: "CONFIRMED" | "REJECTED") {
  const result = await decideStaffAppointment(appointmentId, to);
  if (result.status === "updated") {
    const eventType: NotificationEventType = to === "CONFIRMED" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_REJECTED";
    await publishAppointmentNotification({ tenantId: result.tenantId as never }, appointmentId, eventType);
  }
  return result;
}

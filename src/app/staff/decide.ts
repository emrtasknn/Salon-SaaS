"use server";
import { decideStaffAppointment } from "./actions";
import { publishAppointmentNotification } from "../notification-runtime";
import type { AppointmentRecord } from "../../domain/appointment";
export async function decideAndNotify(appointment:AppointmentRecord,to:"CONFIRMED"|"REJECTED"){const result=await decideStaffAppointment(appointment,to);if(result.status==="updated")await publishAppointmentNotification({tenantId:appointment.tenantId as never},appointment.id,to==="CONFIRMED"?"APPOINTMENT_CONFIRMED":"APPOINTMENT_REJECTED");return result;}

"use server";
import { createPublicBooking } from "../../../application/public-booking";
import { createPrismaPublicBookingRepository } from "../../../persistence/prisma-public-booking";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { publishAppointmentNotification } from "../../notification-runtime";
import { normalizePhoneSubject } from "../../../application/rate-limit";
import { checkRateLimit, readClientIp } from "../../rate-limit-runtime";
export async function submitBooking(input:{slug:string;serviceId:string;staffId:string;startAtIso:string;displayName:string;email:string;phone:string}){const prisma=getPrisma();const v=await createPublicVitrin(createPrismaPublicSalonRepository(prisma)).load(input.slug);if(v.status!=="ok")return{status:"NOT_FOUND" as const};
// WP-5: rate limit before any slot/booking/notification work. Tenant comes from the slug lookup, never from client input.
const tenantId=v.tenantContext.tenantId;const ip=await readClientIp();const limit=await checkRateLimit([{bucket:"booking.submit",tenantId,subject:ip},{bucket:"booking.submit.global",subject:ip},{bucket:"booking.submit.phone",tenantId,subject:normalizePhoneSubject(input.phone)}]);if(limit.status==="RATE_LIMITED")return{status:"RATE_LIMITED" as const,retryAfterSeconds:limit.retryAfterSeconds};
const result=await createPublicBooking(createPrismaPublicBookingRepository(prisma)).create(v.tenantContext,{serviceId:input.serviceId,staffId:input.staffId,startAt:new Date(input.startAtIso),displayName:input.displayName,email:input.email,phone:input.phone});if(result.status==="created")await publishAppointmentNotification(v.tenantContext,result.appointmentId,"APPOINTMENT_CREATED");return result;}

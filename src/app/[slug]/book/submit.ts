"use server";
import { createPublicBooking } from "../../../application/public-booking";
import { createPrismaPublicBookingRepository } from "../../../persistence/prisma-public-booking";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { publishAppointmentNotification } from "../../notification-runtime";
import { normalizePhoneSubject } from "../../../application/rate-limit";
import { checkRateLimit, readClientIp } from "../../rate-limit-runtime";
import type { PublicBookingInput, PublicBookingResult } from "../../legal-consent-contract";
import { ANY_STAFF_ID } from "../../../application/any-staff";
import { anyStaffCandidates } from "./any-staff-runtime";
import { staffPerformsService } from "../../../domain/staff-service";
export async function submitBooking(input:PublicBookingInput):Promise<PublicBookingResult>{const prisma=getPrisma();const v=await createPublicVitrin(createPrismaPublicSalonRepository(prisma)).load(input.slug);if(v.status!=="ok")return{status:"NOT_FOUND" as const};
// WP-07: fast-fail for an inactive salon; the authoritative check is the in-tx FOR SHARE read in persistence.
if(!v.active)return{status:"TENANT_INACTIVE" as const};
// WP-10: fast-fail while the salon's legal fields are missing; re-checked authoritatively in the booking tx.
if(!v.legalReady)return{status:"TENANT_LEGAL_INCOMPLETE" as const};
// WP-5: rate limit before any slot/booking/notification work. Tenant comes from the slug lookup, never from client input.
const tenantId=v.tenantContext.tenantId;const ip=await readClientIp();const limit=await checkRateLimit([{bucket:"booking.submit",tenantId,subject:ip},{bucket:"booking.submit.global",subject:ip},{bucket:"booking.submit.phone",tenantId,subject:normalizePhoneSubject(input.phone)}]);if(limit.status==="RATE_LIMITED")return{status:"RATE_LIMITED" as const,retryAfterSeconds:limit.retryAfterSeconds};
// WP-10: notice/opt-in versions and phone are validated server-side; client hints are not trusted.
const booking=createPublicBooking(createPrismaPublicBookingRepository(prisma));const startAt=new Date(input.startAtIso);
const create=(staffId:string)=>booking.create(v.tenantContext,{serviceId:input.serviceId,staffId,startAt,displayName:input.displayName,email:input.email,phone:input.phone,noticeVersion:input.noticeVersion,noticeHash:input.noticeHash,whatsappOptIn:input.whatsappOptIn,optInVersion:input.optInVersion,optInHash:input.optInHash});
// "Fark etmez" (owner decision 2026-11-06): the server picks a free ACTIVE staff member from its own catalog,
// least busy first, and moves to the next one if the slot was taken meanwhile. The booking tx re-checks as usual.
let result:Awaited<ReturnType<typeof create>>;let staffId=input.staffId;
if(input.staffId===ANY_STAFF_ID){if(Number.isNaN(startAt.getTime()))return{status:"INVALID_INPUT" as const};const candidates=await anyStaffCandidates(v.tenantContext,v.staff.filter((m)=>staffPerformsService(m.serviceIds??[],input.serviceId)).map((m)=>m.id),{serviceId:input.serviceId,startAt,timeZone:v.timezone});result={status:"SLOT_UNAVAILABLE" as const};for(const candidate of candidates){result=await create(candidate);staffId=candidate;if(result.status!=="SLOT_UNAVAILABLE")break;}}
else{result=await create(input.staffId);}
if(result.status!=="created")return result;await publishAppointmentNotification(v.tenantContext,result.appointmentId,"APPOINTMENT_CREATED");return{status:"created" as const,appointmentId:result.appointmentId,statusPath:`/${encodeURIComponent(input.slug)}/randevu/${result.accessToken}`,...(input.staffId===ANY_STAFF_ID?{staffDisplayName:v.staff.find((m)=>m.id===staffId)?.displayName}:{})};}

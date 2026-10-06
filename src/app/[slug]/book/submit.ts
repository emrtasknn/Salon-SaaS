"use server";
import { createPublicBooking } from "../../../application/public-booking";
import { createPrismaPublicBookingRepository } from "../../../persistence/prisma-public-booking";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { publishAppointmentNotification } from "../../notification-runtime";
export async function submitBooking(input:{slug:string;serviceId:string;staffId:string;startAtIso:string;displayName:string;email:string;phone:string}){const prisma=getPrisma();const v=await createPublicVitrin(createPrismaPublicSalonRepository(prisma)).load(input.slug);if(v.status!=="ok")return{status:"NOT_FOUND" as const};const result=await createPublicBooking(createPrismaPublicBookingRepository(prisma)).create(v.tenantContext,{serviceId:input.serviceId,staffId:input.staffId,startAt:new Date(input.startAtIso),displayName:input.displayName,email:input.email,phone:input.phone});if(result.status==="created"){const a=await prisma.appointment.findFirst({where:{tenantId:v.tenantContext.tenantId,serviceId:input.serviceId,staffId:input.staffId,startAt:new Date(input.startAtIso)},orderBy:{id:"desc"}});if(a)await publishAppointmentNotification(v.tenantContext,a.id,"APPOINTMENT_CREATED");}return result;}

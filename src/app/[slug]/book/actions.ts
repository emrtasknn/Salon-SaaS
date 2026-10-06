"use server";
import { createPublicBooking } from "../../../application/public-booking";
import { createPrismaPublicBookingRepository } from "../../../persistence/prisma-public-booking";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
export async function submitPublicBooking(input:{slug:string;serviceId:string;staffId:string;startAtIso:string;displayName:string;email:string;phone:string}) { const prisma=getPrisma(); const v=await createPublicVitrin(createPrismaPublicSalonRepository(prisma)).load(input.slug); if(v.status!=="ok")return{status:"NOT_FOUND" as const}; return createPublicBooking(createPrismaPublicBookingRepository(prisma)).create(v.tenantContext,{serviceId:input.serviceId,staffId:input.staffId,startAt:new Date(input.startAtIso),displayName:input.displayName,email:input.email,phone:input.phone}); }

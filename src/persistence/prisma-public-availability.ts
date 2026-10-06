import type { PublicAvailabilityRepository } from "../application/public-availability";
import type { PrismaTenantClient, PrismaTenantTransactionClient } from "./prisma-tenant-context";
import { withPrismaTenantContext } from "./prisma-tenant-context";
import type { WorkingHoursRecord } from "../domain/working-hours";
import type { AppointmentRecord } from "../domain/appointment";

type Tx=PrismaTenantTransactionClient & {
 tenant:{findUnique(args:{where:{id:string}}):Promise<{id:string;timezone:string}|null>};
 service:{findUnique(args:{where:{tenantId_id:{tenantId:string;id:string}}}):Promise<{durationMinutes:number;bufferMinutes:number;active:boolean}|null>};
 staff:{findUnique(args:{where:{tenantId_id:{tenantId:string;id:string}}}):Promise<{id:string;status:"ACTIVE"|"INACTIVE"}|null>};
 workingHours:{findMany(args:{where:{tenantId:string};orderBy:{dayOfWeek:"asc"}}):Promise<WorkingHoursRecord[]>};
 appointment:{findMany(args:{where:{tenantId:string;staffId:string;startAt:{lt:Date};endAt:{gt:Date}}}):Promise<AppointmentRecord[]>};
};

export function createPrismaPublicAvailabilityRepository(prisma:PrismaTenantClient):PublicAvailabilityRepository{
 return {async read(input){
  return withPrismaTenantContext(prisma,input.tenantContext,async(tx:Tx)=>{
   const tenant=await tx.tenant.findUnique({where:{id:input.tenantContext.tenantId}});
   const service=await tx.service.findUnique({where:{tenantId_id:{tenantId:input.tenantContext.tenantId,id:input.serviceId}}});
   const staff=await tx.staff.findUnique({where:{tenantId_id:{tenantId:input.tenantContext.tenantId,id:input.staffId}}});
   if(!tenant||!service||!staff) return null;
   const workingHours=await tx.workingHours.findMany({where:{tenantId:input.tenantContext.tenantId},orderBy:{dayOfWeek:"asc"}});
   const start=new Date(Date.parse(input.dateIso+"T00:00:00.000Z")-36*60*60*1000);
   const end=new Date(start.getTime()+72*60*60*1000);
   const appointments=await tx.appointment.findMany({where:{tenantId:input.tenantContext.tenantId,staffId:input.staffId,startAt:{lt:end},endAt:{gt:start}}});
   return {timezone:tenant.timezone,durationMinutes:service.durationMinutes,bufferMinutes:service.bufferMinutes,workingHours,appointments,serviceActive:service.active,staffActive:staff.status==="ACTIVE"};
  });
 }};
}

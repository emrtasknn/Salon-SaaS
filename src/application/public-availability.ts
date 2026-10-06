import type { TenantContext } from "../domain/tenant-context";
import type { WorkingHoursRecord } from "../domain/working-hours";
import type { AppointmentRecord } from "../domain/appointment";
import { calculateAvailability, utcToLocalDateAndMinute } from "../domain/availability";

export type PublicAvailabilityRepository = Readonly<{
  read(input: Readonly<{
    tenantContext: TenantContext;
    serviceId: string;
    staffId: string;
    dateIso: string;
  }>): Promise<Readonly<{
    timezone: string;
    durationMinutes: number;
    bufferMinutes: number;
    workingHours: ReadonlyArray<WorkingHoursRecord>;
    appointments: ReadonlyArray<AppointmentRecord>;
    serviceActive: boolean;
    staffActive: boolean;
  }> | null>;
}>;

function validDateIso(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d]=value.split("-").map(Number);
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d;
}

export function createPublicAvailability(repository: PublicAvailabilityRepository) {
  return {
    async list(tenantContext: TenantContext, input: Readonly<{serviceId: unknown;staffId: unknown;dateIso: unknown}>) {
      if (typeof input.serviceId !== "string" || !input.serviceId || typeof input.staffId !== "string" || !input.staffId || !validDateIso(input.dateIso)) {
        return { status: "INVALID_INPUT" as const, slots: [] as const };
      }
      try {
        const data=await repository.read({tenantContext,serviceId:input.serviceId,staffId:input.staffId,dateIso:input.dateIso});
        if (!data || !data.serviceActive || !data.staffActive) return { status: "INVALID_RESOURCE" as const, slots: [] as const };
        const slots=calculateAvailability({
          dateIso:input.dateIso,
          timeZone:data.timezone,
          workingHours:data.workingHours,
          staffId:input.staffId,
          appointments:data.appointments,
          durationMinutes:data.durationMinutes,
          bufferMinutes:data.bufferMinutes,
          now:new Date(),
        }).map(slot=>({startAt:slot.startAt.toISOString(),endAt:slot.endAt.toISOString()}));
        return { status: "ok" as const, slots };
      } catch {
        return { status: "PERSISTENCE_FAILURE" as const, slots: [] as const };
      }
    },
  };
}

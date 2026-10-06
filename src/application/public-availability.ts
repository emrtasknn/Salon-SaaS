import type { TenantContext } from "../domain/tenant-context";
import { calculateAvailability } from "../domain/availability";
import type { AppointmentRecord } from "../domain/appointment";

export type PublicAvailabilityRepository = Readonly<{
  read(tenantContext: TenantContext, input: Readonly<{
    serviceId: string;
    staffId: string;
    dateIso: string;
  }>): Promise<
    | {
        status: "ok";
        timeZone: string;
        durationMinutes: number;
        bufferMinutes: number;
        workingHours: ReadonlyArray<import("../domain/working-hours").WorkingHoursRecord>;
        appointments: ReadonlyArray<AppointmentRecord>;
        serviceActive: boolean;
        staffActive: boolean;
      }
    | { status: "invalid_resource" }\n    | { status: "persistence_failure" }
  >;
}>;

export function createPublicAvailability(repository: PublicAvailabilityRepository) {
  return {
    async list(tenantContext: TenantContext, input: Readonly<{
      serviceId: unknown;
      staffId: unknown;
      dateIso: unknown;
    }>) {
      if (
        typeof input.serviceId !== "string" || !input.serviceId.trim() ||
        typeof input.staffId !== "string" || !input.staffId.trim() ||
        typeof input.dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.dateIso)
      ) {
        return { status: "INVALID_INPUT" as const, slots: [] as const };
      }

      const result = await repository.read(tenantContext, {
        serviceId: input.serviceId.trim(),
        staffId: input.staffId.trim(),
        dateIso: input.dateIso,
      });

      if (result.status === "persistence_failure") return { status: "PERSISTENCE_FAILURE" as const, slots: [] as const };\n      if (result.status === "invalid_resource" || !result.serviceActive || !result.staffActive) {
        return { status: "INVALID_RESOURCE" as const, slots: [] as const };
      }

      try {
        const slots = calculateAvailability({
          dateIso: input.dateIso,
          timeZone: result.timeZone,
          workingHours: result.workingHours,
          staffId: input.staffId,
          appointments: result.appointments,
          durationMinutes: result.durationMinutes,
          bufferMinutes: result.bufferMinutes,
          now: new Date(),
        });
        return {
          status: "ok" as const,
          timeZone: result.timeZone,
          slots: slots.map((slot) => ({
            startAtIso: slot.startAt.toISOString(),
            endAtIso: slot.endAt.toISOString(),
          })),
        };
      } catch {
        return { status: "PERSISTENCE_FAILURE" as const, slots: [] as const };
      }
    },
  };
}

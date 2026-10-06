import type { TenantContext } from "../domain/tenant-context";

export type PublicBookingRepository = Readonly<{
  create(
    tenantContext: TenantContext,
    input: Readonly<{
      serviceId: string; staffId: string; startAt: Date;
      displayName: string; email: string; phone: string | null;
    }>,
  ): Promise<{ status: "created"; appointmentId: string } | "slot_unavailable" | "invalid_resource" | "persistence_failure">;
}>;

function normalizeText(value: unknown, required: boolean): string | null | "INVALID" {
  if (typeof value !== "string") return required ? "INVALID" : null;
  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) return required ? "INVALID" : null;
  return normalized;
}

export function createPublicBooking(repository: PublicBookingRepository) {
  return {
    async create(tenantContext: TenantContext, input: Readonly<{
      serviceId: string; staffId: string; startAt: unknown; displayName: unknown; email: unknown; phone?: unknown;
    }>) {
      const displayName = normalizeText(input.displayName, true);
      const email = normalizeText(input.email, true);
      const phone = normalizeText(input.phone, false);
      if (displayName === "INVALID" || email === "INVALID" || phone === "INVALID" || displayName === null || email === null ||
        !(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime())) return { status: "INVALID_INPUT" as const };
      const result = await repository.create(tenantContext, {
        serviceId: input.serviceId, staffId: input.staffId, startAt: input.startAt,
        displayName, email, phone,
      });
      if (typeof result === "object" && result.status === "created") return { status: "created" as const, appointmentId: result.appointmentId };
      if (result === "slot_unavailable") return { status: "SLOT_UNAVAILABLE" as const };
      if (result === "invalid_resource") return { status: "INVALID_RESOURCE" as const };
      return { status: "PERSISTENCE_FAILURE" as const };
    },
  };
}

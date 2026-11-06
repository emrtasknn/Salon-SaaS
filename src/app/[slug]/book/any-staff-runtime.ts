// Server-only helpers for "Fark etmez" (any staff). Deliberately NOT a "use server" module: these
// take a tenant context and must never be callable from the browser. Callers pass the tenant
// resolved from the slug and the staff ids from the server catalog.
import "server-only";
import { createPublicAvailability } from "../../../application/public-availability";
import { createPrismaPublicAvailabilityRepository } from "../../../persistence/prisma-public-availability";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { dateInTimeZone, staffOrderForSlot, type StaffSlots } from "../../../application/any-staff";

type ListFn = ReturnType<typeof createPublicAvailability>["list"];

/** Per-staff free slots for one day; `ok` when at least one staff member could be read. */
export async function listForAllStaff(
  tenantContext: Parameters<ListFn>[0],
  staffIds: ReadonlyArray<string>,
  input: Readonly<{ serviceId: string; dateIso: string }>,
  list: ListFn,
) {
  const byStaff: StaffSlots[] = [];
  let timeZone = "";
  let firstError: Exclude<Awaited<ReturnType<ListFn>>["status"], "ok"> | null = null;
  for (const staffId of staffIds) {
    const result = await list(tenantContext, { serviceId: input.serviceId, staffId, dateIso: input.dateIso });
    if (result.status === "ok") {
      timeZone = result.timeZone;
      byStaff.push({ staffId, slots: result.slots });
    } else if (!firstError) {
      firstError = result.status;
    }
  }
  if (byStaff.length === 0) return { status: firstError ?? ("INVALID_RESOURCE" as const) };
  return { status: "ok" as const, timeZone, byStaff };
}

/**
 * Server-only helper for submit: who can take `startAt` when the customer chose "Fark etmez".
 * Least busy first; empty when nobody is free.
 */
export async function anyStaffCandidates(
  tenantContext: Parameters<ListFn>[0],
  staffIds: ReadonlyArray<string>,
  input: Readonly<{ serviceId: string; startAt: Date; timeZone: string }>,
): Promise<string[]> {
  const availability = createPublicAvailability(createPrismaPublicAvailabilityRepository(getPrisma()));
  const dateIso = dateInTimeZone(input.startAt, input.timeZone);
  const perStaff = await listForAllStaff(tenantContext, staffIds, { serviceId: input.serviceId, dateIso }, availability.list);
  return perStaff.status === "ok" ? staffOrderForSlot(perStaff.byStaff, input.startAt.toISOString()) : [];
}

// Booking submission lives only in `./submit.ts` (`submitBooking`), which also
// publishes APPOINTMENT_CREATED. Do not add a second booking server action here;
// `submit.test.ts` pins this module's exports.

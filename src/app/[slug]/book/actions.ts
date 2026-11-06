"use server";

import { createPublicAvailability } from "../../../application/public-availability";
import { createPrismaPublicAvailabilityRepository } from "../../../persistence/prisma-public-availability";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { checkRateLimit, readClientIp } from "../../rate-limit-runtime";
import { ANY_STAFF_ID, mergeAnyStaffSlots } from "../../../application/any-staff";
import { listForAllStaff } from "./any-staff-runtime";

async function loadTenant(slug: string) {
  const prisma = getPrisma();
  return createPublicVitrin(createPrismaPublicSalonRepository(prisma)).load(slug);
}

export async function getPublicAvailability(input: {
  slug: string;
  serviceId: string;
  staffId: string;
  dateIso: string;
}) {
  const v = await loadTenant(input.slug);
  if (v.status !== "ok") return { status: v.status, slots: [] as const };
  // WP-07: an inactive salon offers no slots.
  if (!v.active) return { status: "TENANT_INACTIVE" as const, slots: [] as const };
  // WP-5: per-IP limit before any availability query.
  const limit = await checkRateLimit([{ bucket: "booking.availability", subject: await readClientIp() }]);
  if (limit.status === "RATE_LIMITED") {
    return { status: "RATE_LIMITED" as const, retryAfterSeconds: limit.retryAfterSeconds, slots: [] as const };
  }
  const availability = createPublicAvailability(createPrismaPublicAvailabilityRepository(getPrisma()));
  if (input.staffId !== ANY_STAFF_ID) return availability.list(v.tenantContext, input);
  // "Fark etmez": union of the salon's ACTIVE staff (server catalog, never client input). One rate-limit
  // charge for the whole request; staff are read one after another to stay light on the DB pool.
  const perStaff = await listForAllStaff(v.tenantContext, v.staff.map((member) => member.id), input, availability.list);
  if (perStaff.status !== "ok") return { status: perStaff.status, slots: [] as const };
  return { status: "ok" as const, timeZone: perStaff.timeZone, slots: mergeAnyStaffSlots(perStaff.byStaff) };
}

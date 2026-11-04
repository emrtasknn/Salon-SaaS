"use server";

import { createPublicAvailability } from "../../../application/public-availability";
import { createPrismaPublicAvailabilityRepository } from "../../../persistence/prisma-public-availability";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";

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
  return createPublicAvailability(createPrismaPublicAvailabilityRepository(getPrisma())).list(v.tenantContext, input);
}

// Booking submission lives only in `./submit.ts` (`submitBooking`), which also
// publishes APPOINTMENT_CREATED. Do not add a second booking server action here;
// `submit.test.ts` pins this module's exports.

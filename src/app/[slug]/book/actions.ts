"use server";

import { createPublicAvailability } from "../../../application/public-availability";
import { createPrismaPublicAvailabilityRepository } from "../../../persistence/prisma-public-availability";
import { createPublicBooking } from "../../../application/public-booking";
import { createPrismaPublicBookingRepository } from "../../../persistence/prisma-public-booking";
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

export async function submitPublicBooking(input: {
  slug: string;
  serviceId: string;
  staffId: string;
  startAtIso: string;
  displayName: string;
  email: string;
  phone: string;
}) {
  const v = await loadTenant(input.slug);
  if (v.status !== "ok") return { status: "NOT_FOUND" as const };
  return createPublicBooking(createPrismaPublicBookingRepository(getPrisma())).create(v.tenantContext, {
    serviceId: input.serviceId,
    staffId: input.staffId,
    startAt: new Date(input.startAtIso),
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
  });
}

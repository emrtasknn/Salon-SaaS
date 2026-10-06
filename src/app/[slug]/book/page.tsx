export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { createPublicVitrin } from "../../../application/public-vitrin";
import { createPrismaPublicSalonRepository } from "../../../persistence/prisma-public-vitrin";
import { getPrisma } from "../../../infrastructure/prisma-runtime";
import { PublicBookingForm } from "./form";

function todayInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ service?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const prisma = getPrisma();
  const vitrin = await createPublicVitrin(createPrismaPublicSalonRepository(prisma)).load(slug);
  if (vitrin.status !== "ok") notFound();

  return (
    <PublicBookingForm
      slug={slug}
      services={vitrin.services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
      }))}
      staff={vitrin.staff.map((member) => ({
        id: member.id,
        displayName: member.displayName,
      }))}
      timeZone={vitrin.timezone}
      minDate={todayInTimeZone(vitrin.timezone)}
      initialServiceId={query.service && vitrin.services.some((service) => service.id === query.service) ? query.service : ""}
    />
  );
}

import "server-only";

import { generatePassword, generateUsername, hashPassword } from "../domain/caldav-credentials";
import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaPhoneCalendarRepository } from "../persistence/prisma-phone-calendar";
import { readSessionMember } from "./session-member";

/** The signed-in member who may own a RandevuN calendar account (admin, or active staff). */
export async function phoneCalendarMember() {
  const member = await readSessionMember();
  if (!member || (!member.isAdmin && !member.activeStaffId)) return null;
  return member;
}

/** Issues a fresh account for the signed-in member (the previous one stops working). */
export async function issuePhoneCalendarAccount(member: NonNullable<Awaited<ReturnType<typeof phoneCalendarMember>>>) {
  const tenant = await member.prisma.tenant.findUnique({ where: { id: member.tenantContext.tenantId }, select: { slug: true, name: true } });
  if (!tenant) return null;
  const username = generateUsername(tenant.slug);
  const password = generatePassword();
  await createPrismaPhoneCalendarRepository(getPrisma()).issue(member.tenantContext, {
    profileId: member.profileId,
    username,
    passwordHash: hashPassword(password),
    now: new Date(),
  });
  return { username, password, salonName: tenant.name, memberKey: `${member.tenantContext.tenantId}:${member.profileId}` };
}

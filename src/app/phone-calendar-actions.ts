"use server";

import { headers } from "next/headers";

import { getPrisma } from "../infrastructure/prisma-runtime";
import { createPrismaPhoneCalendarRepository } from "../persistence/prisma-phone-calendar";
import { issuePhoneCalendarAccount, phoneCalendarMember } from "./phone-calendar-runtime";

// ADR-045 phase C settings actions: the signed-in user's own RandevuN calendar account.
// Tenant and profile come from the session only.

export type PhoneCalendarView =
  | Readonly<{ status: "ok"; active: boolean; username: string | null; host: string | null; lastSeenAt: string | null }>
  | Readonly<{ status: "UNAUTHORIZED" }>;

export type PhoneCalendarCredentials =
  | Readonly<{ status: "ok"; host: string; username: string; password: string }>
  | Readonly<{ status: "UNAUTHORIZED" }>;

async function host(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host");
}

export async function getPhoneCalendarStatus(): Promise<PhoneCalendarView> {
  const member = await phoneCalendarMember();
  if (!member) return { status: "UNAUTHORIZED" };
  const status = await createPrismaPhoneCalendarRepository(getPrisma()).status(member.tenantContext, member.profileId);
  return { status: "ok", active: status.active, username: status.username, host: await host(), lastSeenAt: status.lastSeenAt?.toISOString() ?? null };
}

/** Manual setup: a new account whose password is shown once. */
export async function createPhoneCalendarAccount(): Promise<PhoneCalendarCredentials> {
  const member = await phoneCalendarMember();
  const appHost = await host();
  if (!member || !appHost) return { status: "UNAUTHORIZED" };
  const issued = await issuePhoneCalendarAccount(member);
  if (!issued) return { status: "UNAUTHORIZED" };
  return { status: "ok", host: appHost, username: issued.username, password: issued.password };
}

export async function revokePhoneCalendarAccount(): Promise<PhoneCalendarView> {
  const member = await phoneCalendarMember();
  if (!member) return { status: "UNAUTHORIZED" };
  await createPrismaPhoneCalendarRepository(getPrisma()).revoke(member.tenantContext, { profileId: member.profileId, now: new Date() });
  return getPhoneCalendarStatus();
}

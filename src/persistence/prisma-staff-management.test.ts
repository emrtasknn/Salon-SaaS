import { describe, expect, it, vi } from "vitest";
import {
  createPrismaStaffRepository,
  type PrismaStaffClient,
} from "./prisma-staff-management";
import type { TenantContext } from "../domain/tenant-context";

const tenantContext = { tenantId: "tenant-1" } as TenantContext;

function makePrisma() {
  const staffRow = {
    id: "staff-1",
    tenantId: "tenant-1",
    profileId: "profile-1",
    status: "ACTIVE" as const,
    profile: {
      displayName: "Ada Yılmaz",
      phone: "+905551112233",
    },
  };

  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    profile: {
      create: vi.fn().mockResolvedValue({ id: "profile-1" }),
      update: vi.fn().mockResolvedValue({ id: "profile-1" }),
    },
    tenantMembership: {
      create: vi.fn().mockResolvedValue({ id: "membership-1" }),
    },
    staff: {
      create: vi.fn().mockResolvedValue(staffRow),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({
        id: "staff-1",
        tenantId: "tenant-1",
        profileId: "profile-1",
        status: "ACTIVE",
      }),
      findMany: vi.fn().mockResolvedValue([staffRow]),
    },
  };

  const prisma = {
    $transaction: vi.fn(
      async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx),
    ),
  } as unknown as PrismaStaffClient;

  return { tx, prisma, staffRow };
}

describe("prisma staff repository", () => {
  it("sets tenant context and creates staff records within the tenant", async () => {
    const { prisma, tx } = makePrisma();

    const result = await createPrismaStaffRepository(prisma).create({
      tenantId: "tenant-1",
      subjectId: "auth-subject-1",
      displayName: "Ada Yılmaz",
      email: "ada@example.com",
      phone: "+905551112233",
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.profile.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        displayName: "Ada Yılmaz",
        email: "ada@example.com",
        phone: "+905551112233",
      },
    });
    expect(tx.tenantMembership.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        subjectId: "auth-subject-1",
        profileId: "profile-1",
        role: "STAFF",
      },
    });
    expect(tx.staff.create).toHaveBeenCalledWith({
      data: {
        tenantId: "tenant-1",
        profileId: "profile-1",
        status: "ACTIVE",
      },
      include: {
        profile: {
          select: { displayName: true, phone: true },
        },
      },
    });
    expect(result).toEqual({
      status: "created",
      staff: {
        id: "staff-1",
        tenantId: "tenant-1",
        profileId: "profile-1",
        status: "ACTIVE",
        displayName: "Ada Yılmaz",
        phone: "+905551112233",
      },
    });
  });

  it("uses tenant composite identities when updating a staff profile", async () => {
    const { prisma, tx } = makePrisma();

    await expect(
      createPrismaStaffRepository(prisma).updateProfile(tenantContext, "staff-1", {
        displayName: "Ada Kaya",
        phone: "+905559998877",
      }),
    ).resolves.toBe("updated");

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.staff.findUnique).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "staff-1" } },
    });
    expect(tx.profile.update).toHaveBeenCalledWith({
      where: { tenantId_id: { tenantId: "tenant-1", id: "profile-1" } },
      data: {
        displayName: "Ada Kaya",
        phone: "+905559998877",
      },
    });
  });

  it("does not update a profile when the staff record is absent from the tenant", async () => {
    const { prisma, tx } = makePrisma();
    tx.staff.findUnique.mockResolvedValue(null);

    await expect(
      createPrismaStaffRepository(prisma).updateProfile(
        tenantContext,
        "staff-other-tenant",
        { displayName: "Intruder" },
      ),
    ).resolves.toBe("not_found");

    expect(tx.profile.update).not.toHaveBeenCalled();
    expect(tx.staff.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_id: {
          tenantId: "tenant-1",
          id: "staff-other-tenant",
        },
      },
    });
  });

  it("scopes status changes and list operations to the tenant", async () => {
    const { prisma, tx } = makePrisma();

    await expect(
      createPrismaStaffRepository(prisma).setStatus(
        tenantContext,
        "staff-1",
        "INACTIVE",
      ),
    ).resolves.toBe("updated");

    const records = await createPrismaStaffRepository(prisma).list(tenantContext);

    expect(tx.staff.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", id: "staff-1" },
      data: { status: "INACTIVE" },
    });
    expect(tx.staff.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1" },
      select: {
        id: true,
        tenantId: true,
        profileId: true,
        status: true,
        profile: {
          select: { displayName: true, phone: true },
        },
      },
    });
    expect(records).toEqual([
      {
        id: "staff-1",
        tenantId: "tenant-1",
        profileId: "profile-1",
        status: "ACTIVE",
        displayName: "Ada Yılmaz",
        phone: "+905551112233",
      },
    ]);
  });
});

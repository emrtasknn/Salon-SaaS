import { describe, expect, it, vi } from "vitest";
import {
  createPrismaAdminSelfStaffRepository,
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

describe("Prisma admin self-staff repository (owner decision 2026-11-05)", () => {
  function makeSelfPrisma() {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      staff: {
        findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
        create: vi.fn().mockResolvedValue({ id: "staff-1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) };
    return { prisma, tx };
  }

  it("reactivates the own row with a tenant-scoped update inside the tenant context", async () => {
    const { prisma, tx } = makeSelfPrisma();
    await expect(createPrismaAdminSelfStaffRepository(prisma as unknown as PrismaStaffClient).setOwnStatus(tenantContext, "profile-1", "ACTIVE"))
      .resolves.toBe("updated");
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.$executeRaw.mock.calls[0]).toContain("tenant-1");
    expect(tx.staff.updateMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-1", profileId: "profile-1" }, data: { status: "ACTIVE" } });
    expect(tx.staff.create).not.toHaveBeenCalled();
  });

  it("creates the own row only when no row exists in this tenant, and surfaces create errors", async () => {
    const { prisma, tx } = makeSelfPrisma();
    tx.staff.updateMany.mockResolvedValue({ count: 0 });
    const repository = createPrismaAdminSelfStaffRepository(prisma as unknown as PrismaStaffClient);
    await expect(repository.setOwnStatus(tenantContext, "profile-1", "ACTIVE")).resolves.toBe("updated");
    expect(tx.staff.create).toHaveBeenCalledWith({ data: { tenantId: "tenant-1", profileId: "profile-1", status: "ACTIVE" }, select: { id: true } });
    // e.g. the profile belongs to another tenant: unique profileId / composite FK violation must not be swallowed.
    tx.staff.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    await expect(repository.setOwnStatus(tenantContext, "profile-1", "ACTIVE")).rejects.toThrow("Unique constraint failed");
  });

  it("deactivates only an existing own row and never creates one", async () => {
    const { prisma, tx } = makeSelfPrisma();
    const repository = createPrismaAdminSelfStaffRepository(prisma as unknown as PrismaStaffClient);
    await expect(repository.setOwnStatus(tenantContext, "profile-1", "INACTIVE")).resolves.toBe("updated");
    expect(tx.staff.updateMany).toHaveBeenCalledWith({ where: { tenantId: "tenant-1", profileId: "profile-1" }, data: { status: "INACTIVE" } });
    tx.staff.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.setOwnStatus(tenantContext, "profile-1", "INACTIVE")).resolves.toBe("not_found");
    expect(tx.staff.create).not.toHaveBeenCalled();
  });

  it("reads the own row status scoped to the tenant", async () => {
    const { prisma, tx } = makeSelfPrisma();
    const repository = createPrismaAdminSelfStaffRepository(prisma as unknown as PrismaStaffClient);
    await expect(repository.findOwnStatus(tenantContext, "profile-1")).resolves.toBe("ACTIVE");
    expect(tx.staff.findUnique).toHaveBeenCalledWith({
      where: { tenantId_profileId: { tenantId: "tenant-1", profileId: "profile-1" } },
      select: { status: true },
    });
    tx.staff.findUnique.mockResolvedValue(null);
    await expect(repository.findOwnStatus(tenantContext, "profile-1")).resolves.toBeNull();
  });
});

import type {
  StaffRepository,
  StaffProvisioningRepositoryInput,
  StaffListRecord,
} from "../application/staff-management";
import type { StaffRecord } from "../domain/staff";
import {
  withPrismaTenantContext,
  type PrismaTenantClient,
  type PrismaTenantTransactionClient,
} from "./prisma-tenant-context";
import type { TenantContext } from "../domain/tenant-context";

type StaffIdentityRow = Readonly<{
  id: string;
  tenantId: string;
  profileId: string;
  status: "ACTIVE" | "INACTIVE";
}>;

type StaffRow = StaffIdentityRow &
  Readonly<{
    profile: Readonly<{
      displayName: string;
      phone: string | null;
    }>;
  }>;

export type PrismaStaffTransaction = PrismaTenantTransactionClient & {
  profile: {
    create(args: {
      data: {
        tenantId: string;
        displayName: string;
        email?: string | null;
        phone?: string | null;
      };
    }): Promise<{ id: string }>;
    update(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
      data: {
        displayName?: string;
        email?: string | null;
        phone?: string | null;
      };
    }): Promise<{ id: string }>;
  };
  tenantMembership: PrismaTenantTransactionClient["tenantMembership"] & {
    create(args: {
      data: {
        tenantId: string;
        subjectId: string;
        profileId: string;
        role: "STAFF";
      };
    }): Promise<{ id: string }>;
  };
  staff: {
    create(args: {
      data: { tenantId: string; profileId: string; status: "ACTIVE" };
      include: {
        profile: {
          select: { displayName: true; phone: true };
        };
      };
    }): Promise<StaffRow>;
    updateMany(args: {
      where: { tenantId: string; id: string };
      data: { status: "ACTIVE" | "INACTIVE" };
    }): Promise<{ count: number }>;
    findMany(args: {
      where: { tenantId: string };
      select: {
        id: true;
        tenantId: true;
        profileId: true;
        status: true;
        profile: {
          select: {
            displayName: true;
            phone: true;
          };
        };
      };
    }): Promise<StaffRow[]>;
    findUnique(args: {
      where: { tenantId_id: { tenantId: string; id: string } };
    }): Promise<StaffIdentityRow | null>;
  };
};

export type PrismaStaffClient = PrismaTenantClient;

function toStaff(row: StaffRow): StaffListRecord {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    profileId: row.profileId,
    status: row.status,
    displayName: row.profile.displayName,
    phone: row.profile.phone,
  });
}

export function createPrismaStaffRepository(
  prisma: PrismaStaffClient,
): StaffRepository {
  return {
    async create(input: StaffProvisioningRepositoryInput) {
      try {
        const staff = await withPrismaTenantContext(
          prisma,
          { tenantId: input.tenantId as TenantContext["tenantId"] },
          async (tx: PrismaStaffTransaction) => {
            const profile = await tx.profile.create({
              data: {
                tenantId: input.tenantId,
                displayName: input.displayName,
                email: input.email,
                phone: input.phone,
              },
            });
            await tx.tenantMembership.create({
              data: {
                tenantId: input.tenantId,
                subjectId: input.subjectId,
                profileId: profile.id,
                role: "STAFF",
              },
            });
            return tx.staff.create({
              data: {
                tenantId: input.tenantId,
                profileId: profile.id,
                status: "ACTIVE",
              },
              include: {
                profile: {
                  select: {
                    displayName: true,
                    phone: true,
                  },
                },
              },
            });
          },
        );
        return { status: "created" as const, staff: toStaff(staff) };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
          return { status: "conflict" as const };
        throw error;
      }
    },
    async updateProfile(tenantContext, staffId, patch) {
      try {
        return await withPrismaTenantContext(
          prisma,
          tenantContext,
          async (tx: PrismaStaffTransaction) => {
            const staff = await tx.staff.findUnique({
              where: {
                tenantId_id: { tenantId: tenantContext.tenantId, id: staffId },
              },
            });
            if (!staff) return "not_found" as const;
            await tx.profile.update({
              where: {
                tenantId_id: {
                  tenantId: tenantContext.tenantId,
                  id: staff.profileId,
                },
              },
              data: patch,
            });
            return "updated" as const;
          },
        );
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
          return "conflict" as const;
        throw error;
      }
    },
    async setStatus(tenantContext, staffId, status) {
      const result = await withPrismaTenantContext(
        prisma,
        tenantContext,
        async (tx: PrismaStaffTransaction) =>
          tx.staff.updateMany({
            where: { tenantId: tenantContext.tenantId, id: staffId },
            data: { status },
          }),
      );
      return result.count === 1 ? "updated" : "not_found";
    },
    async list(tenantContext) {
      const rows = await withPrismaTenantContext(
        prisma,
        tenantContext,
        async (tx: PrismaStaffTransaction) =>
          tx.staff.findMany({
            where: { tenantId: tenantContext.tenantId },
            select: {
              id: true,
              tenantId: true,
              profileId: true,
              status: true,
              profile: {
                select: {
                  displayName: true,
                  phone: true,
                },
              },
            },
          }),
      );
      return rows.map(toStaff);
    },
  };
}

import type {
  TenantProvisioningRepository,
  TenantProvisioningRepositoryInput,
  TenantProvisioningRepositoryResult,
} from "../application/tenant-provisioning";

export interface PrismaProvisioningTransaction {
  tenant: {
    create(args: {
      data: {
        id: string;
        slug: string;
        name: string;
        timezone: string;
      };
    }): Promise<{ id: string }>;
  };
  profile: {
    create(args: {
      data: {
        tenantId: string;
        displayName: string;
        email?: string | null;
        phone?: string | null;
      };
    }): Promise<{ id: string }>;
  };
  tenantMembership: {
    create(args: {
      data: {
        tenantId: string;
        subjectId: string;
        profileId: string;
        role: "TENANT_ADMIN";
      };
    }): Promise<{ id: string }>;
  };
}

export interface PrismaProvisioningClient {
  $transaction<T>(
    operation: (tx: PrismaProvisioningTransaction) => Promise<T>,
  ): Promise<T>;
}

export function createPrismaTenantProvisioningRepository(
  prisma: PrismaProvisioningClient,
): TenantProvisioningRepository {
  return {
    async provision(
      input: TenantProvisioningRepositoryInput,
    ): Promise<TenantProvisioningRepositoryResult> {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: {
              id: input.tenant.tenantId,
              slug: input.tenant.slug,
              name: input.tenant.name,
              timezone: input.tenant.timezone,
            },
          });

          const profile = await tx.profile.create({
            data: {
              tenantId: tenant.id,
              displayName: input.firstAdmin.displayName,
              email: input.firstAdmin.email,
              phone: input.firstAdmin.phone,
            },
          });

          await tx.tenantMembership.create({
            data: {
              tenantId: tenant.id,
              subjectId: input.firstAdmin.subjectId,
              profileId: profile.id,
              role: "TENANT_ADMIN",
            },
          });

          return { tenantId: tenant.id, profileId: profile.id };
        });

        return { status: "created", ...result };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          return { status: "duplicate_slug" };
        }

        throw error;
      }
    },
  };
}
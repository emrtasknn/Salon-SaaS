import type { AuthenticatedIdentity } from "../domain/auth-identity";
import type { AuthorizationMembership } from "../domain/authorization";
import type {
  MembershipLookupInput,
  MembershipLookupResult,
  MembershipReader,
} from "./membership";

type MembershipRow = Readonly<{
  tenantId: string;
  subjectId: string;
  profileId: string;
  role: AuthorizationMembership["role"];
}>;

export interface TenantMembershipDelegate {
  findUnique(args: {
    where: {
      tenantId_subjectId: {
        tenantId: string;
        subjectId: string;
      };
    };
  }): Promise<MembershipRow | null>;
}

export interface PrismaMembershipReaderDependencies {
  tenantMembership: TenantMembershipDelegate;
}

function toMembership(row: MembershipRow): AuthorizationMembership {
  return Object.freeze({
    tenantId: row.tenantId as AuthorizationMembership["tenantId"],
    subjectId: row.subjectId as AuthenticatedIdentity["subjectId"],
    profileId: row.profileId,
    role: row.role,
  });
}

export function createPrismaMembershipReader(
  dependencies: PrismaMembershipReaderDependencies,
): MembershipReader {
  return {
    async readMembership(
      input: MembershipLookupInput,
    ): Promise<MembershipLookupResult> {
      try {
        const row = await dependencies.tenantMembership.findUnique({
          where: {
            tenantId_subjectId: {
              tenantId: input.tenantContext.tenantId,
              subjectId: input.identity.subjectId,
            },
          },
        });

        if (row === null) {
          return { status: "not_found" };
        }

        return {
          status: "found",
          membership: toMembership(row),
        };
      } catch {
        return {
          status: "error",
          error: "PERSISTENCE_FAILURE",
        };
      }
    },
  };
}

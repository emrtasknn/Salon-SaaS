import {
  createTenantContext,
  type DomainResult,
  type TenantContext,
  type TenantId,
} from "./tenant-context";

export type TenantResolutionResult =
  | Readonly<{ status: "resolved"; context: TenantContext }>
  | Readonly<{ status: "invalid_input"; reason: string }>
  | Readonly<{ status: "not_found" }>;

export type TenantResolutionSource = Readonly<{
  slug: string;
}>;

export function resolveTenantContext(
  source: unknown,
  resolveTenantId: (slug: string) => DomainResult<TenantId> | null,
): TenantResolutionResult {
  if (
    typeof source !== "object" ||
    source === null ||
    !("slug" in source) ||
    typeof source.slug !== "string" ||
    source.slug.length === 0 ||
    source.slug.trim() !== source.slug
  ) {
    return { status: "invalid_input", reason: "Tenant slug is invalid" };
  }

  const tenantIdResult = resolveTenantId(source.slug);

  if (tenantIdResult === null) {
    return { status: "not_found" };
  }

  if (!tenantIdResult.ok) {
    return { status: "invalid_input", reason: tenantIdResult.error.message };
  }

  const contextResult = createTenantContext({
    tenantId: tenantIdResult.value,
  });

  if (!contextResult.ok) {
    return { status: "invalid_input", reason: contextResult.error.message };
  }

  return {
    status: "resolved",
    context: contextResult.value,
  };
}

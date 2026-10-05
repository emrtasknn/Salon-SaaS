import { createTenantContext, createTenantId, type TenantContext, type TenantId } from "./tenant-context";

export type TenantResolutionResult =
  | Readonly<{ status: "resolved"; context: TenantContext }>
  | Readonly<{ status: "invalid_input"; reason: string }>
  | Readonly<{ status: "not_found" }>;

export type TenantResolutionSource = Readonly<{
  slug: string;
}>;

export function resolveTenantContext(
  source: unknown,
  resolveTenantId: (slug: string) => TenantId | null,
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

  const slug = source.slug;
  const tenantId = resolveTenantId(slug);

  if (tenantId === null) {
    return { status: "not_found" };
  }

  return {
    status: "resolved",
    context: createTenantContext(createTenantId(tenantId)),
  };
}

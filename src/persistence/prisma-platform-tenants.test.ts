import { describe, expect, it, vi } from "vitest";
import { createPrismaPlatformTenantRepository, type PrismaPlatformTenantClient } from "./prisma-platform-tenants";

const AT = new Date("2026-11-16T10:00:00.000Z");

function makeClient(tenants: Array<{ id: string; slug: string; status: string; deletedAt: Date | null }>) {
  const findFirst = vi.fn(async (args: { where: { id: string; deletedAt: null } }) =>
    tenants.find((t) => t.id === args.where.id && t.deletedAt === null) ?? null,
  );
  const updateMany = vi.fn(async (args: { where: { id: string; deletedAt?: null; status?: string; slug?: string }; data: { status?: string; deletedAt?: Date } }) => {
    const row = tenants.find(
      (t) =>
        t.id === args.where.id &&
        (args.where.deletedAt === undefined || t.deletedAt === null) &&
        (args.where.status === undefined || t.status === args.where.status) &&
        (args.where.slug === undefined || t.slug === args.where.slug),
    );
    if (!row) return { count: 0 };
    if (args.data.deletedAt) row.deletedAt = args.data.deletedAt;
    if (args.data.status) row.status = args.data.status;
    return { count: 1 };
  });
  const findMany = vi.fn().mockResolvedValue([]);
  const client = { tenant: { findMany, findFirst, updateMany } } as unknown as PrismaPlatformTenantClient;
  return { client, findFirst, updateMany, findMany };
}

describe("prisma platform tenant repository", () => {
  it("list excludes archived tenants", async () => {
    const { client, findMany } = makeClient([]);
    await createPrismaPlatformTenantRepository(client).list();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null } }));
  });

  it("setStatus cannot reactivate an archived tenant", async () => {
    const { client, updateMany } = makeClient([{ id: "t1", slug: "salon-a", status: "INACTIVE", deletedAt: AT }]);
    await expect(createPrismaPlatformTenantRepository(client).setStatus("t1", "ACTIVE")).resolves.toBe("not_found");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "t1", deletedAt: null }, data: { status: "ACTIVE" } });
  });

  it("archive: unknown or already archived tenant is not_found", async () => {
    const { client } = makeClient([{ id: "t1", slug: "salon-a", status: "INACTIVE", deletedAt: AT }]);
    const repo = createPrismaPlatformTenantRepository(client);
    await expect(repo.archive("missing", "salon-a", AT)).resolves.toBe("not_found");
    await expect(repo.archive("t1", "salon-a", AT)).resolves.toBe("not_found");
  });

  it("archive: ACTIVE tenant is refused without writing", async () => {
    const { client, updateMany } = makeClient([{ id: "t1", slug: "salon-a", status: "ACTIVE", deletedAt: null }]);
    await expect(createPrismaPlatformTenantRepository(client).archive("t1", "salon-a", AT)).resolves.toBe("active");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each(["Salon-A", " salon-a", "salon-a ", "other"])("archive: slug %j mismatches exactly", async (confirm) => {
    const { client, updateMany } = makeClient([{ id: "t1", slug: "salon-a", status: "INACTIVE", deletedAt: null }]);
    await expect(createPrismaPlatformTenantRepository(client).archive("t1", confirm, AT)).resolves.toBe("slug_mismatch");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("archive: exact slug on INACTIVE tenant archives with a conditional write, second call is not_found", async () => {
    const { client, updateMany } = makeClient([{ id: "t1", slug: "salon-a", status: "INACTIVE", deletedAt: null }]);
    const repo = createPrismaPlatformTenantRepository(client);
    await expect(repo.archive("t1", "salon-a", AT)).resolves.toBe("archived");
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "t1", deletedAt: null, status: "INACTIVE", slug: "salon-a" }, data: { deletedAt: AT } });
    await expect(repo.archive("t1", "salon-a", AT)).resolves.toBe("not_found");
  });

  it("archive: concurrent reactivation (0 count) is re-read and reported as active", async () => {
    const rows = [{ id: "t1", slug: "salon-a", status: "INACTIVE", deletedAt: null as Date | null }];
    const { client, findFirst, updateMany } = makeClient(rows);
    updateMany.mockImplementationOnce(async () => {
      rows[0]!.status = "ACTIVE";
      return { count: 0 };
    });
    await expect(createPrismaPlatformTenantRepository(client).archive("t1", "salon-a", AT)).resolves.toBe("active");
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("archive: slug changed concurrently (0 count, re-read differs) is slug_mismatch", async () => {
    const rows = [{ id: "t1", slug: "salon-a", status: "INACTIVE", deletedAt: null as Date | null }];
    const { client, updateMany } = makeClient(rows);
    updateMany.mockImplementationOnce(async () => {
      rows[0]!.slug = "salon-b";
      return { count: 0 };
    });
    await expect(createPrismaPlatformTenantRepository(client).archive("t1", "salon-a", AT)).resolves.toBe("slug_mismatch");
  });

  it("archive: concurrent archive (0 count, row gone) is not_found", async () => {
    const rows = [{ id: "t1", slug: "salon-a", status: "INACTIVE", deletedAt: null as Date | null }];
    const { client, updateMany } = makeClient(rows);
    updateMany.mockImplementationOnce(async () => {
      rows[0]!.deletedAt = AT;
      return { count: 0 };
    });
    await expect(createPrismaPlatformTenantRepository(client).archive("t1", "salon-a", AT)).resolves.toBe("not_found");
  });
});

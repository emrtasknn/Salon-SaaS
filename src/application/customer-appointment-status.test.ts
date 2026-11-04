import { describe, expect, it, vi } from "vitest";
import type { AppointmentStatus } from "../domain/appointment";
import { generateAppointmentAccessToken } from "../domain/appointment-access-token";
import {
  createCustomerAppointmentStatus,
  type CustomerAppointmentCancelTx,
  type CustomerAppointmentStatusRepository,
  type StatusLinkTenant,
} from "./customer-appointment-status";

const NOW = new Date("2026-11-05T06:00:00.000Z");
const START = new Date("2026-11-05T10:00:00.000Z"); // deadline 08:00Z
const END = new Date("2026-11-05T10:45:00.000Z");

type Row = { tenantId: string; appointmentId: string; tokenHash: string; revoked: boolean; expiresAt: Date; status: AppointmentStatus; startAt: Date };

const tenants: Record<string, StatusLinkTenant> = {
  "salon-a": { tenantContext: { tenantId: "tenant-a" as never }, name: "Salon A", timezone: "Europe/Istanbul" },
  "salon-b": { tenantContext: { tenantId: "tenant-b" as never }, name: "Salon B", timezone: "Europe/Istanbul" },
};

function setup(options: { status?: AppointmentStatus; startAt?: Date; revoked?: boolean; expiresAt?: Date; now?: Date; limited?: boolean } = {}) {
  const { token, tokenHash } = generateAppointmentAccessToken();
  const row: Row = {
    tenantId: "tenant-a", appointmentId: "appt-a", tokenHash, revoked: options.revoked ?? false,
    expiresAt: options.expiresAt ?? new Date("2026-11-12T10:45:00.000Z"),
    status: options.status ?? "PENDING", startAt: options.startAt ?? START,
  };
  const usable = (tenantId: string, hash: string, now: Date) =>
    row.tenantId === tenantId && row.tokenHash === hash && !row.revoked && row.expiresAt.getTime() > now.getTime();
  const tenantIds: string[] = [];
  const updateStatus = vi.fn(async (tenantId: string, id: string, from: AppointmentStatus, to: AppointmentStatus) => {
    if (row.tenantId !== tenantId || row.appointmentId !== id || row.status !== from) return false;
    row.status = to;
    return true;
  });
  const repository = {
    findDetailsByTokenHash: vi.fn(async (ctx: { tenantId: string }, hash: string, now: Date) => {
      tenantIds.push(ctx.tenantId);
      return usable(ctx.tenantId, hash, now)
        ? { appointmentId: row.appointmentId, status: row.status, startAt: row.startAt, endAt: END, serviceName: "Saç Kesimi", staffName: "Ali" }
        : null;
    }),
    inCancelTransaction: vi.fn(async <T,>(ctx: { tenantId: string }, operation: (tx: CustomerAppointmentCancelTx) => Promise<T>) => {
      tenantIds.push(ctx.tenantId);
      return operation({
        findByTokenHash: async (hash, now) => usable(ctx.tenantId, hash, now)
          ? { appointmentId: row.appointmentId, status: row.status, startAt: row.startAt } : null,
        readAppointment: async (id) => row.tenantId === ctx.tenantId && row.appointmentId === id ? { status: row.status, startAt: row.startAt } : null,
        updateStatus: (id, from, to) => updateStatus(ctx.tenantId, id, from, to),
      });
    }),
  };
  const hits: string[] = [];
  const limiter = { hit: vi.fn(async (bucket: "status.view" | "status.miss") => { hits.push(bucket); return options.limited ? "limited" as const : "allowed" as const; }) };
  const logCancelled = vi.fn();
  const resolveTenantBySlug = vi.fn(async (slug: string) => tenants[slug] ?? null);
  const typedRepository = repository as unknown as CustomerAppointmentStatusRepository;
  const service = createCustomerAppointmentStatus({ resolveTenantBySlug, repository: typedRepository, limiter, now: () => options.now ?? NOW, logCancelled });
  return { service, token, row, repository, limiter, hits, logCancelled, resolveTenantBySlug, updateStatus, tenantIds };
}

describe("customer appointment status — view", () => {
  it("returns only the contract fields for a usable token", async () => {
    const { service, token, hits, tenantIds } = setup({ status: "CONFIRMED" });
    const result = await service.view(" Salon-A ", token);
    expect(result).toEqual({
      status: "ok",
      appointment: {
        salonName: "Salon A", serviceName: "Saç Kesimi", staffName: "Ali",
        startAtIso: START.toISOString(), endAtIso: END.toISOString(), timeZone: "Europe/Istanbul",
        status: "CONFIRMED", canCancel: true, cancelDeadlineIso: "2026-11-05T08:00:00.000Z",
      },
    });
    expect(hits).toEqual(["status.view"]);
    expect(tenantIds).toEqual(["tenant-a"]);
  });

  it("reports canCancel false after the cutoff", async () => {
    const { service, token } = setup({ now: new Date("2026-11-05T08:00:00.000Z") });
    const result = await service.view("salon-a", token);
    expect(result.status === "ok" && result.appointment.canCancel).toBe(false);
  });

  it("returns RATE_LIMITED before any lookup", async () => {
    const { service, token, resolveTenantBySlug, repository, hits } = setup({ limited: true });
    await expect(service.view("salon-a", token)).resolves.toEqual({ status: "RATE_LIMITED" });
    expect(hits).toEqual(["status.view"]);
    expect(resolveTenantBySlug).not.toHaveBeenCalled();
    expect(repository.findDetailsByTokenHash).not.toHaveBeenCalled();
  });

  it("returns RATE_LIMITED for a miss once the IP is over the status.miss budget", async () => {
    const ctx = setup();
    ctx.limiter.hit.mockImplementation(async (bucket: "status.view" | "status.miss") => {
      ctx.hits.push(bucket);
      return bucket === "status.miss" ? "limited" as const : "allowed" as const;
    });
    await expect(ctx.service.view("salon-b", ctx.token)).resolves.toEqual({ status: "RATE_LIMITED" });
    await expect(ctx.service.cancel("salon-b", ctx.token)).resolves.toEqual({ status: "RATE_LIMITED" });
    // A valid token is unaffected by the miss budget.
    await expect(ctx.service.view("salon-a", ctx.token)).resolves.toMatchObject({ status: "ok" });
    expect(ctx.row.status).toBe("PENDING");
  });

  it.each([
    ["malformed token", {}, "salon-a", "not-a-token"],
    ["unknown slug", {}, "salon-x", null],
    ["cross-tenant token (A's token under B's slug)", {}, "salon-b", null],
    ["expired token", { expiresAt: NOW }, "salon-a", null],
    ["revoked token", { revoked: true }, "salon-a", null],
  ] as const)("returns generic NOT_FOUND for %s and counts a miss", async (_label, options, slug, tokenOverride) => {
    const ctx = setup(options);
    const result = await ctx.service.view(slug, tokenOverride ?? ctx.token);
    expect(result).toEqual({ status: "NOT_FOUND" });
    expect(ctx.hits).toEqual(["status.view", "status.miss"]);
  });

  it("looks a cross-tenant token up only under the slug's tenant", async () => {
    const { service, token, tenantIds } = setup();
    await service.view("salon-b", token);
    expect(tenantIds).toEqual(["tenant-b"]);
  });

  it("does not query the repository for a malformed token", async () => {
    const { service, repository, resolveTenantBySlug } = setup();
    await service.view("salon-a", "x".repeat(44));
    expect(resolveTenantBySlug).not.toHaveBeenCalled();
    expect(repository.findDetailsByTokenHash).not.toHaveBeenCalled();
  });
});

describe("customer appointment status — cancel", () => {
  it.each(["PENDING", "CONFIRMED"] as const)("cancels a %s appointment and logs without the token", async (status) => {
    const { service, token, row, logCancelled, updateStatus } = setup({ status });
    await expect(service.cancel("salon-a", token)).resolves.toEqual({ status: "CANCELLED" });
    expect(row.status).toBe("CANCELLED");
    expect(row.revoked).toBe(false);
    expect(updateStatus).toHaveBeenCalledWith("tenant-a", "appt-a", status, "CANCELLED");
    expect(logCancelled).toHaveBeenCalledWith({ tenantId: "tenant-a", appointmentId: "appt-a", actorKind: "customer_token" });
    expect(JSON.stringify(logCancelled.mock.calls)).not.toContain(token);
  });

  it("is idempotent: a second cancel returns ALREADY_CANCELLED without writing", async () => {
    const { service, token, updateStatus, logCancelled } = setup();
    await service.cancel("salon-a", token);
    await expect(service.cancel("salon-a", token)).resolves.toEqual({ status: "ALREADY_CANCELLED" });
    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(logCancelled).toHaveBeenCalledTimes(1);
  });

  it.each(["REJECTED", "COMPLETED"] as const)("returns NOT_CANCELLABLE for %s", async (status) => {
    const { service, token, updateStatus } = setup({ status });
    await expect(service.cancel("salon-a", token)).resolves.toEqual({ status: "NOT_CANCELLABLE" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("enforces the 120-minute cutoff boundary", async () => {
    const justBefore = setup({ now: new Date("2026-11-05T07:59:59.999Z") });
    await expect(justBefore.service.cancel("salon-a", justBefore.token)).resolves.toEqual({ status: "CANCELLED" });
    const atDeadline = setup({ now: new Date("2026-11-05T08:00:00.000Z") });
    await expect(atDeadline.service.cancel("salon-a", atDeadline.token)).resolves.toEqual({ status: "CUTOFF_PASSED" });
    expect(atDeadline.updateStatus).not.toHaveBeenCalled();
  });

  it("retries once when the status changed concurrently (PENDING -> CONFIRMED)", async () => {
    const ctx = setup({ status: "PENDING" });
    ctx.updateStatus.mockImplementationOnce(async () => { ctx.row.status = "CONFIRMED"; return false; });
    await expect(ctx.service.cancel("salon-a", ctx.token)).resolves.toEqual({ status: "CANCELLED" });
    expect(ctx.updateStatus).toHaveBeenNthCalledWith(2, "tenant-a", "appt-a", "CONFIRMED", "CANCELLED");
    expect(ctx.row.status).toBe("CANCELLED");
  });

  it("returns ALREADY_CANCELLED when a concurrent cancel won the race", async () => {
    const ctx = setup({ status: "CONFIRMED" });
    ctx.updateStatus.mockImplementationOnce(async () => { ctx.row.status = "CANCELLED"; return false; });
    await expect(ctx.service.cancel("salon-a", ctx.token)).resolves.toEqual({ status: "ALREADY_CANCELLED" });
    expect(ctx.logCancelled).not.toHaveBeenCalled();
  });

  it("gives up with NOT_CANCELLABLE when the retry also loses", async () => {
    const ctx = setup({ status: "PENDING" });
    ctx.updateStatus.mockResolvedValue(false);
    await expect(ctx.service.cancel("salon-a", ctx.token)).resolves.toEqual({ status: "NOT_CANCELLABLE" });
    expect(ctx.updateStatus).toHaveBeenCalledTimes(2);
  });

  it("returns RATE_LIMITED without opening a transaction", async () => {
    const { service, token, repository } = setup({ limited: true });
    await expect(service.cancel("salon-a", token)).resolves.toEqual({ status: "RATE_LIMITED" });
    expect(repository.inCancelTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed token", "salon-a", "x".repeat(44)],
    ["non-string token", "salon-a", undefined],
    ["token with a trailing slash", "salon-a", "TOKEN/"],
  ] as const)("returns NOT_FOUND for a %s without resolving the tenant or opening a transaction", async (_label, slug, token) => {
    const ctx = setup();
    await expect(ctx.service.cancel(slug, token === "TOKEN/" ? `${ctx.token}/` : token)).resolves.toEqual({ status: "NOT_FOUND" });
    expect(ctx.resolveTenantBySlug).not.toHaveBeenCalled();
    expect(ctx.repository.inCancelTransaction).not.toHaveBeenCalled();
    expect(ctx.hits).toEqual(["status.view", "status.miss"]);
  });

  it.each([
    ["unknown slug", "salon-x"],
    ["empty slug", "   "],
    ["non-string slug", 42],
    ["over-long slug", "a".repeat(101)],
  ] as const)("returns NOT_FOUND for an %s without opening a transaction", async (_label, slug) => {
    const ctx = setup();
    await expect(ctx.service.cancel(slug, ctx.token)).resolves.toEqual({ status: "NOT_FOUND" });
    expect(ctx.repository.inCancelTransaction).not.toHaveBeenCalled();
    expect(ctx.row.status).toBe("PENDING");
    expect(ctx.hits).toEqual(["status.view", "status.miss"]);
  });

  it("returns CUTOFF_PASSED after startAt and never cancels a past appointment", async () => {
    const ctx = setup({ status: "CONFIRMED", now: new Date("2026-11-05T10:30:00.000Z") });
    await expect(ctx.service.cancel("salon-a", ctx.token)).resolves.toEqual({ status: "CUTOFF_PASSED" });
    expect(ctx.updateStatus).not.toHaveBeenCalled();
    expect(ctx.logCancelled).not.toHaveBeenCalled();
  });

  it("passes neither the raw token nor its hash to the cancel log", async () => {
    const ctx = setup();
    await ctx.service.cancel("salon-a", ctx.token);
    const logged = JSON.stringify(ctx.logCancelled.mock.calls);
    expect(logged).not.toContain(ctx.token);
    expect(logged).not.toContain(ctx.row.tokenHash);
  });

  it("works without a logCancelled hook", async () => {
    const { token, repository, limiter } = setup();
    const service = createCustomerAppointmentStatus({
      resolveTenantBySlug: async (slug) => tenants[slug] ?? null,
      repository: repository as unknown as CustomerAppointmentStatusRepository, limiter, now: () => NOW,
    });
    await expect(service.cancel("salon-a", token)).resolves.toEqual({ status: "CANCELLED" });
  });

  it.each([
    ["cross-tenant token", {}, "salon-b"],
    ["expired token", { expiresAt: NOW }, "salon-a"],
    ["revoked token", { revoked: true }, "salon-a"],
  ] as const)("returns NOT_FOUND for %s without writing", async (_label, options, slug) => {
    const ctx = setup(options);
    await expect(ctx.service.cancel(slug, ctx.token)).resolves.toEqual({ status: "NOT_FOUND" });
    expect(ctx.updateStatus).not.toHaveBeenCalled();
    expect(ctx.row.status).toBe("PENDING");
    expect(ctx.hits).toEqual(["status.view", "status.miss"]);
  });
});

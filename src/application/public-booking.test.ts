import { describe, expect, it, vi } from "vitest";
import { hashAppointmentAccessToken } from "../domain/appointment-access-token";
import { createPublicBooking } from "./public-booking";
import { CUSTOMER_NOTICE, WHATSAPP_OPTIN } from "../domain/legal-notice";

const tenant = { tenantId: "tenant-a" as never };
const validInput = {
  serviceId: "svc-a", staffId: "staff-a", startAt: new Date("2026-10-05T06:00:00Z"),
  displayName: " Customer ", email: "c@example.com", phone: "0555 111 22 33",
  noticeVersion: CUSTOMER_NOTICE.version, noticeHash: "a".repeat(64), whatsappOptIn: false, optInVersion: null, optInHash: null,
};

describe("public booking", () => {
  it("validates customer input before persistence", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    const result = await createPublicBooking(repository).create(tenant, validInput);
    expect(result).toEqual({ status: "created", appointmentId: "appointment-a", accessToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(repository.create).toHaveBeenCalled();
  });

  it("passes only the access-token hash to persistence and returns the raw token once", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    const result = await createPublicBooking(repository).create(tenant, validInput);
    if (result.status !== "created") throw new Error("expected created");
    const persisted = repository.create.mock.calls[0][1];
    expect(persisted.accessTokenHash).toBe(hashAppointmentAccessToken(result.accessToken));
    expect(persisted.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(repository.create.mock.calls)).not.toContain(result.accessToken);
  });

  it("does not return a token when the booking is not created", async () => {
    const repository = { create: vi.fn().mockResolvedValue("slot_unavailable") };
    await expect(createPublicBooking(repository).create(tenant, validInput)).resolves.toEqual({ status: "SLOT_UNAVAILABLE" });
  });

  it("rejects malformed customer input", async () => {
    const repository = { create: vi.fn() };
    await expect(createPublicBooking(repository).create(tenant, {
      ...validInput, startAt: "bad", displayName: "", email: "x",
    })).resolves.toEqual({ status: "INVALID_INPUT" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("surfaces tenant-scoped resource rejection without retrying persistence", async () => {
    const repository = { create: vi.fn().mockResolvedValue("invalid_resource") };
    await expect(createPublicBooking(repository).create(tenant, validInput))
      .resolves.toEqual({ status: "INVALID_RESOURCE" });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("maps tenant_inactive to TENANT_INACTIVE without returning a token (WP-07)", async () => {
    const repository = { create: vi.fn().mockResolvedValue("tenant_inactive") };
    await expect(createPublicBooking(repository).create(tenant, validInput)).resolves.toEqual({ status: "TENANT_INACTIVE" });
  });

  it("normalizes the phone to E.164 and passes no opt-in by default (WP-10)", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    await createPublicBooking(repository).create(tenant, validInput);
    expect(repository.create.mock.calls[0][1]).toMatchObject({ displayName: "Customer", phone: "+905551112233", whatsappOptIn: false });
  });

  it("empty phone becomes null; a non-normalizable phone is INVALID_PHONE (WP-10)", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    await createPublicBooking(repository).create(tenant, { ...validInput, phone: "  " });
    expect(repository.create.mock.calls[0][1].phone).toBeNull();
    await expect(createPublicBooking(repository).create(tenant, { ...validInput, phone: "+90555" })).resolves.toEqual({ status: "INVALID_PHONE" });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale or missing notice version, and a stale opt-in version, as NOTICE_STALE (WP-10)", async () => {
    const repository = { create: vi.fn() };
    const booking = createPublicBooking(repository);
    await expect(booking.create(tenant, { ...validInput, noticeVersion: "v0" })).resolves.toEqual({ status: "NOTICE_STALE" });
    await expect(booking.create(tenant, { ...validInput, noticeVersion: undefined })).resolves.toEqual({ status: "NOTICE_STALE" });
    await expect(booking.create(tenant, { ...validInput, whatsappOptIn: true, optInVersion: "v0", optInHash: "b".repeat(64) })).resolves.toEqual({ status: "NOTICE_STALE" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("opt-in requires a phone (OPT_IN_REQUIRES_PHONE) and passes the opt-in when valid (WP-10)", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    const booking = createPublicBooking(repository);
    await expect(booking.create(tenant, { ...validInput, phone: "", whatsappOptIn: true, optInVersion: WHATSAPP_OPTIN.version, optInHash: "b".repeat(64) }))
      .resolves.toEqual({ status: "OPT_IN_REQUIRES_PHONE" });
    expect(repository.create).not.toHaveBeenCalled();
    await booking.create(tenant, { ...validInput, whatsappOptIn: true, optInVersion: WHATSAPP_OPTIN.version, optInHash: "b".repeat(64) });
    expect(repository.create.mock.calls[0][1]).toMatchObject({ phone: "+905551112233", whatsappOptIn: true, shownNoticeHash: "a".repeat(64), shownOptInHash: "b".repeat(64) });
  });

  it("rejects a non-boolean opt-in flag and malformed email as INVALID_INPUT (WP-10)", async () => {
    const repository = { create: vi.fn() };
    const booking = createPublicBooking(repository);
    await expect(booking.create(tenant, { ...validInput, whatsappOptIn: "true" })).resolves.toEqual({ status: "INVALID_INPUT" });
    await expect(booking.create(tenant, { ...validInput, email: "no-at-sign" })).resolves.toEqual({ status: "INVALID_INPUT" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("maps tenant_legal_incomplete to TENANT_LEGAL_INCOMPLETE (WP-10)", async () => {
    const repository = { create: vi.fn().mockResolvedValue("tenant_legal_incomplete") };
    await expect(createPublicBooking(repository).create(tenant, validInput)).resolves.toEqual({ status: "TENANT_LEGAL_INCOMPLETE" });
  });

  it("requires well-formed shown hashes (64 lowercase hex) -> else INVALID_INPUT (WP-10)", async () => {
    const repository = { create: vi.fn() };
    const booking = createPublicBooking(repository);
    for (const noticeHash of [undefined, "", "A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
      await expect(booking.create(tenant, { ...validInput, noticeHash })).resolves.toEqual({ status: "INVALID_INPUT" });
    }
    await expect(booking.create(tenant, { ...validInput, whatsappOptIn: true, optInVersion: WHATSAPP_OPTIN.version, optInHash: null }))
      .resolves.toEqual({ status: "INVALID_INPUT" });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("ignores an opt-in hash when not opted in and passes null (WP-10)", async () => {
    const repository = { create: vi.fn().mockResolvedValue({ status: "created", appointmentId: "appointment-a" }) };
    await createPublicBooking(repository).create(tenant, { ...validInput, optInHash: "zz" });
    expect(repository.create.mock.calls[0][1]).toMatchObject({ whatsappOptIn: false, shownNoticeHash: "a".repeat(64), shownOptInHash: null });
  });

  it("maps notice_stale (shown text differs from the text in force) to NOTICE_STALE (WP-10)", async () => {
    const repository = { create: vi.fn().mockResolvedValue("notice_stale") };
    await expect(createPublicBooking(repository).create(tenant, validInput)).resolves.toEqual({ status: "NOTICE_STALE" });
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeleteButton, runDelete, shouldRefreshAfterBlocked } from "./delete-button";
import { AppointmentDeleteButton, canOfferAppointmentDelete } from "./appointment-delete-button";

describe("runDelete", () => {
  it("passes the typed text to the action and reports DELETED as ok", async () => {
    const run = vi.fn().mockResolvedValue({ status: "DELETED" });
    await expect(runDelete(run, "salon-a")).resolves.toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith("salon-a");
  });

  it("keeps the dialog open with the Turkish reason for a blocked result", async () => {
    const run = async () => ({ status: "HAS_ACTIVE_APPOINTMENTS" as const, count: 2 });
    await expect(runDelete(run)).resolves.toEqual({
      ok: false,
      error: "2 ileri tarihli aktif randevu var. Önce iptal edin veya taşıyın.",
      result: { status: "HAS_ACTIVE_APPOINTMENTS", count: 2 },
    });
  });

  it("turns a thrown error into the generic message", async () => {
    const run = async () => {
      throw new Error("boom");
    };
    await expect(runDelete(run)).resolves.toEqual({
      ok: false,
      error: "Silinemedi. Lütfen tekrar deneyin.",
      result: { status: "PERSISTENCE_FAILURE" },
    });
  });
});

describe("shouldRefreshAfterBlocked", () => {
  it("refreshes only when the record is gone (stale list)", () => {
    expect(shouldRefreshAfterBlocked({ status: "NOT_FOUND" })).toBe(true);
    expect(shouldRefreshAfterBlocked({ status: "FORBIDDEN" })).toBe(false);
    expect(shouldRefreshAfterBlocked({ status: "HAS_ACTIVE_APPOINTMENTS", count: 1 })).toBe(false);
  });
});

describe("DeleteButton", () => {
  const props = {
    ariaLabel: "Ayşe Yılmaz personelini sil",
    title: "Personel silinsin mi?",
    description: "giriş erişimi kapatılır, geçmiş randevular korunur",
    run: async () => ({ status: "DELETED" as const }),
    onDeleted: () => {},
  };

  it("renders a named quiet trigger and no dialog until opened", () => {
    const html = renderToStaticMarkup(<DeleteButton {...props} />);
    expect(html).toContain('aria-label="Ayşe Yılmaz personelini sil"');
    expect(html).toContain(">Sil<");
    expect(html).not.toContain("<dialog");
  });

  it("shows the consequence in the dialog when open", () => {
    const html = renderToStaticMarkup(<DeleteButton {...props} defaultOpen />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("giriş erişimi kapatılır, geçmiş randevular korunur");
  });
});

describe("AppointmentDeleteButton", () => {
  const base = { appointmentId: "a1", summary: "Ayşe · Saç", run: async () => ({ status: "DELETED" as const }), onDeleted: () => {} };

  it("offers delete for REJECTED and CANCELLED to staff, not for COMPLETED or active ones", () => {
    expect(canOfferAppointmentDelete("ASSIGNED_STAFF", "REJECTED")).toBe(true);
    expect(canOfferAppointmentDelete("ASSIGNED_STAFF", "CANCELLED")).toBe(true);
    expect(canOfferAppointmentDelete("ASSIGNED_STAFF", "COMPLETED")).toBe(false);
    expect(canOfferAppointmentDelete("ASSIGNED_STAFF", "PENDING")).toBe(false);
    expect(canOfferAppointmentDelete("ASSIGNED_STAFF", "CONFIRMED")).toBe(false);
  });

  it("offers delete for COMPLETED to admins too", () => {
    expect(canOfferAppointmentDelete("TENANT_ADMIN", "COMPLETED")).toBe(true);
    expect(canOfferAppointmentDelete("TENANT_ADMIN", "PENDING")).toBe(false);
  });

  it("renders nothing for a status the actor cannot delete", () => {
    expect(renderToStaticMarkup(<AppointmentDeleteButton {...base} actor="ASSIGNED_STAFF" status="COMPLETED" />)).toBe("");
    expect(renderToStaticMarkup(<AppointmentDeleteButton {...base} actor="TENANT_ADMIN" status="CONFIRMED" />)).toBe("");
  });

  it("renders a named button for an allowed status", () => {
    const html = renderToStaticMarkup(<AppointmentDeleteButton {...base} actor="TENANT_ADMIN" status="COMPLETED" />);
    expect(html).toContain('aria-label="Ayşe · Saç randevusunu sil"');
  });
});

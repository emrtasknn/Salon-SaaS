import { describe, expect, it } from "vitest";
import { deleteErrorMessage } from "./delete-messages";

describe("deleteErrorMessage", () => {
  it("maps every failure code to Turkish copy", () => {
    expect(deleteErrorMessage({ status: "HAS_ACTIVE_APPOINTMENTS", count: 3 })).toBe(
      "3 ileri tarihli aktif randevu var. Önce iptal edin veya taşıyın.",
    );
    expect(deleteErrorMessage({ status: "MUST_CANCEL_FIRST" })).toBe("Aktif randevu silinemez. Önce iptal edin.");
    expect(deleteErrorMessage({ status: "TENANT_ACTIVE" })).toBe("Önce salonu pasif duruma alın.");
    expect(deleteErrorMessage({ status: "CONFIRMATION_MISMATCH" })).toBe("Yazdığınız adres eşleşmiyor.");
    expect(deleteErrorMessage({ status: "NOT_DELETABLE" })).toBe("Bu kayıt silinemez.");
    expect(deleteErrorMessage({ status: "NOT_FOUND" })).toBe("Kayıt bulunamadı veya zaten silinmiş.");
    expect(deleteErrorMessage({ status: "FORBIDDEN" })).toBe("Bu işlem için yetkiniz yok.");
  });

  it("falls back to a generic message", () => {
    expect(deleteErrorMessage({ status: "INVALID_INPUT" })).toBe("Silinemedi. Lütfen tekrar deneyin.");
    expect(deleteErrorMessage({ status: "PERSISTENCE_FAILURE" })).toBe("Silinemedi. Lütfen tekrar deneyin.");
  });
});

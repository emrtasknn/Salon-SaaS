import type { DeleteResult } from "@/domain/deletion";

/** Turkish user-facing message for a failed delete. Presentation only; the server decides. */
export function deleteErrorMessage(result: Exclude<DeleteResult, { status: "DELETED" }>): string {
  switch (result.status) {
    case "HAS_ACTIVE_APPOINTMENTS":
      return `${result.count} aktif randevu var. Önce tamamlayın, iptal edin veya taşıyın.`;
    case "MUST_CANCEL_FIRST":
      return "Aktif randevu silinemez. Önce iptal edin.";
    case "TENANT_ACTIVE":
      return "Önce salonu pasif duruma alın.";
    case "CONFIRMATION_MISMATCH":
      return "Yazdığınız adres eşleşmiyor.";
    case "NOT_DELETABLE":
      return "Bu kayıt silinemez.";
    case "NOT_FOUND":
      return "Kayıt bulunamadı veya zaten silinmiş.";
    case "FORBIDDEN":
      return "Bu işlem için yetkiniz yok.";
    default:
      return "Silinemedi. Lütfen tekrar deneyin.";
  }
}

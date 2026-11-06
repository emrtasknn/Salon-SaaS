import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmButton } from "./confirm-button";

describe("ConfirmButton", () => {
  it("shows only the trigger until it is pressed", () => {
    const html = renderToStaticMarkup(
      <ConfirmButton label="İptal et" question="Randevu iptal edilsin mi?" confirmLabel="Evet, iptal et" onConfirm={() => {}} />,
    );
    expect(html).toContain(">İptal et<");
    expect(html).not.toContain("Randevu iptal edilsin mi?");
  });

  it("asks before running the action and offers a way back", () => {
    const html = renderToStaticMarkup(
      <ConfirmButton
        label="Reddet"
        question="Talep reddedilsin mi?"
        detail="Müşteriye bildirim gider. Geri alınamaz."
        confirmLabel="Evet, reddet"
        onConfirm={() => {}}
        defaultOpen
      />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain("Talep reddedilsin mi?");
    expect(html).toContain("Müşteriye bildirim gider. Geri alınamaz.");
    expect(html).toContain(">Evet, reddet<");
    expect(html).toContain(">Vazgeç<");
    expect(html).not.toContain(">Reddet<");
  });
});

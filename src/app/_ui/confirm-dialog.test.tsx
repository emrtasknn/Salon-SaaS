import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { canConfirm, canDismiss, ConfirmDialog } from "./confirm-dialog";

const base = { title: "Personeli sil", description: "Bu işlem geri alınamaz.", onConfirm: () => {}, onCancel: () => {} };

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    expect(renderToStaticMarkup(<ConfirmDialog {...base} open={false} />)).toBe("");
  });

  it("is a labelled modal alertdialog with a destructive confirm", () => {
    const html = renderToStaticMarkup(<ConfirmDialog {...base} open />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain("Personeli sil");
    expect(html).toContain("Bu işlem geri alınamaz.");
    expect(html).toContain(">Sil<");
    expect(html).toContain(">Vazgeç<");
    expect(html).toContain("bg-destructive");
  });

  it("renders the error and a custom confirm label", () => {
    const html = renderToStaticMarkup(<ConfirmDialog {...base} open confirmLabel="Salonu sil" error="Bu kayıt silinemez." />);
    expect(html).toContain("Bu kayıt silinemez.");
    expect(html).toContain(">Salonu sil<");
  });

  it("disables both buttons while pending", () => {
    const html = renderToStaticMarkup(<ConfirmDialog {...base} open pending />);
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it("shows a labelled input and disables confirm until the text matches", () => {
    const html = renderToStaticMarkup(<ConfirmDialog {...base} open requireText="salon-a" requireTextLabel="Salon adresini yazın" />);
    expect(html).toContain("Salon adresini yazın");
    expect(html).toContain("<input");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Sil/);
  });

  it("confirm requires an exact, case-sensitive match", () => {
    expect(canConfirm({ requireText: "salon-a", typed: "Salon-A", pending: false })).toBe(false);
    expect(canConfirm({ requireText: "salon-a", typed: "salon-a", pending: false })).toBe(true);
    expect(canConfirm({ requireText: "salon-a", typed: "salon-a", pending: true })).toBe(false);
    expect(canConfirm({ typed: "", pending: false })).toBe(true);
  });

  it("Escape and backdrop dismiss only when not pending", () => {
    expect(canDismiss(false)).toBe(true);
    expect(canDismiss(true)).toBe(false);
  });
});

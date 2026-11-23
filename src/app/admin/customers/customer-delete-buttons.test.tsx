import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("./actions", () => ({ deleteCustomerAction: vi.fn(), deleteCustomerNoteAction: vi.fn() }));

import { DeleteCustomerButton, DeleteNoteButton } from "./customer-delete-buttons";

describe("customer delete buttons", () => {
  it("names the customer being deleted", () => {
    const html = renderToStaticMarkup(<DeleteCustomerButton customerId="c1" name="Zeynep Kaya" />);
    expect(html).toContain('aria-label="Zeynep Kaya müşterisini sil"');
  });

  it("names the note being deleted", () => {
    const html = renderToStaticMarkup(<DeleteNoteButton noteId="n1" />);
    expect(html).toContain('aria-label="Notu sil"');
  });
});

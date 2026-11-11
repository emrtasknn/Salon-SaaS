import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DateField } from "./date-field";

describe("DateField", () => {
  it("shows a short Turkish date and keeps the native date input for picking", () => {
    const html = renderToStaticMarkup(<DateField value="2026-11-10" onChange={() => {}} />);
    expect(html).toContain("10 Kas 2026");
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-11-10"/);
    expect(html).toContain('aria-label="Tarih"');
  });

  it("takes the native input out of the layout so it cannot push the row wider", () => {
    // iOS gives date inputs an intrinsic width that ignores min-width; the visible part is a plain label.
    const html = renderToStaticMarkup(<DateField value="2026-11-10" onChange={() => {}} />);
    expect(html).toMatch(/<input[^>]*class="[^"]*absolute inset-0[^"]*opacity-0/);
    expect(html).toMatch(/<span[^>]*class="[^"]*truncate/);
  });

  it("passes disabled through", () => {
    expect(renderToStaticMarkup(<DateField value="2026-11-10" onChange={() => {}} disabled />)).toMatch(/<input[^>]*disabled/);
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusToggle } from "./status-toggle";

describe("StatusToggle", () => {
  it("exposes state as a switch and in visible text", () => {
    const on = renderToStaticMarkup(<StatusToggle active name="Ayşe" />);
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('aria-label="Ayşe: aktif"');
    expect(on).toContain(">Aktif<");

    const off = renderToStaticMarkup(<StatusToggle active={false} name="Kesim" />);
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain(">Pasif<");
  });

  it("is disabled and busy while pending", () => {
    const html = renderToStaticMarkup(<StatusToggle active name="Salon" pending type="submit" />);
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });
});

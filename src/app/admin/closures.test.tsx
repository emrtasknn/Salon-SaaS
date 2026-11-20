import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./closure-actions", () => ({
  createClosure: vi.fn(),
  deleteClosure: vi.fn(),
  listClosures: vi.fn(),
  previewClosureImpact: vi.fn(),
}));

import { AdminClosures } from "./closures";

describe("AdminClosures delete", () => {
  it("keeps one named remove button per upcoming closure and no inline question", () => {
    const html = renderToStaticMarkup(
      <AdminClosures
        embedded
        initialRange={{ from: "2099-01-01", to: "2099-12-31" }}
        initialData={{ status: "OK", timezone: "Europe/Istanbul", closures: [{ id: "k1", date: "2099-05-01", reason: null }] } as never}
      />,
    );
    expect(html).toMatch(/aria-label="[^"]*kapalı gününü kaldır"/);
    expect(html).not.toContain("Kaldırılsın mı?");
    expect(html).not.toContain("<dialog");
  });
});

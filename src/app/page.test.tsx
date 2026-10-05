import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/image", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ src, alt }: { src?: string; alt?: string }) =>
      createElement("img", { src, alt }),
  };
});

import Home from "./page";

describe("smoke", () => {
  it("exports a renderable home page", () => {
    expect(typeof Home).toBe("function");
    const html = renderToStaticMarkup(Home());
    expect(html.length).toBeGreaterThan(0);
  });
});

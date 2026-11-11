import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SuccessMark } from "./success-mark";

describe("SuccessMark", () => {
  const html = renderToStaticMarkup(<SuccessMark className="mb-4" />);

  it("is decoration: the text beside it carries the meaning", () => {
    expect(html).toMatch(/^<span[^>]*aria-hidden="true"/);
  });

  it("draws a tick on the accent disc", () => {
    expect(html).toMatch(/class="[^"]*success-mark[^"]*bg-accent[^"]*text-on-accent/);
    expect(html).toContain("<path");
    expect(html).toContain("mb-4");
  });

  it("only animates when motion is allowed and is complete at rest", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");
    const start = css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .success-mark");
    expect(start).toBeGreaterThan(0);
    // No animation on the mark outside that block.
    const outside = css.slice(0, start);
    expect(outside).not.toMatch(/\.success-mark[^{]*\{[^}]*animation:/);
  });
});

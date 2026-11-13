import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LogoMark, Wordmark } from "./logo";

describe("Wordmark", () => {
  const html = renderToStaticMarkup(<Wordmark className="h-9" />);

  it("is one labelled image", () => {
    expect(html).toMatch(/^<svg[^>]*role="img"/);
    expect(html).toContain('aria-label="RandevuN"');
    expect(html).toContain('class="h-9');
  });

  it("is drawn as outlines so it never depends on a font loading", () => {
    expect(html).not.toContain("<text");
    expect(html.match(/<path /g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("takes the text colour for the letters and the accent token for the dot", () => {
    expect(html).toContain('fill="currentColor"');
    expect(html).toMatch(/<circle[^>]*class="fill-accent"/);
  });
});

describe("LogoMark", () => {
  it("draws the N on the brand tile with the dot", () => {
    const html = renderToStaticMarkup(<LogoMark className="size-10" />);
    expect(html).toContain('aria-label="RandevuN"');
    expect(html).toMatch(/<rect[^>]*class="fill-brand"/);
    expect(html).toMatch(/<path[^>]*class="fill-on-brand"/);
    expect(html).toMatch(/<circle[^>]*class="fill-accent"/);
  });
});

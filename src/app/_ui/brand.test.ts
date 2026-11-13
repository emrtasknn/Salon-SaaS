import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Brand foundation (owner approval 2026-11-11): "Çam & Lila" palette, Fraunces display type,
// the "İmza" logo. Guards the places where the same values must agree.

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "public/manifest.json"), "utf8")) as {
  background_color: string;
  theme_color: string;
};

function block(startMarker: RegExp): Record<string, string> {
  const start = css.search(startMarker);
  if (start < 0) throw new Error(`block not found: ${startMarker}`);
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase();
  return out;
}

const light = block(/^@theme \{/m);
const dark = block(/^:root\[data-theme="dark"\] \{/m);

describe("Çam & Lila palette", () => {
  it("uses mist for the page and pine for primary actions in the light theme", () => {
    expect(light["--color-canvas"]).toBe("#f6f6fa");
    expect(light["--color-ink"]).toBe("#13211f");
    expect(light["--color-action"]).toBe("#1f3b38");
    expect(light["--color-tint"]).toBe("#e6e6fa");
  });

  it("uses night pine for the page and lilac for primary actions in the dark theme", () => {
    expect(dark["--color-canvas"]).toBe("#0b1413");
    expect(dark["--color-action"]).toBe("#dcdcf8");
    expect(dark["--color-on-action"]).toBe("#13211f");
  });

  it("keeps the brand pine identical in both themes", () => {
    expect(light["--color-brand"]).toBe("#1f3b38");
    expect(dark["--color-brand"]).toBe(light["--color-brand"]);
    expect(dark["--color-on-brand"]).toBe(light["--color-on-brand"]);
  });

  it("keeps emerald as the confirmation accent", () => {
    expect(light["--color-accent"]).toBe("#10b981");
    expect(dark["--color-accent"]).toBe("#34d399");
  });
});

describe("browser chrome colours", () => {
  it("manifest splash and theme colour match the light canvas", () => {
    expect(manifest.background_color.toLowerCase()).toBe(light["--color-canvas"]);
    expect(manifest.theme_color.toLowerCase()).toBe(light["--color-canvas"]);
  });

  it("theme-color meta follows each theme's canvas", () => {
    expect(layout.toLowerCase()).toContain(`color: "${light["--color-canvas"]}"`);
    expect(layout.toLowerCase()).toContain(`color: "${dark["--color-canvas"]}"`);
  });
});

describe("display type", () => {
  it("registers Fraunces as the display family with a serif fallback", () => {
    expect(layout).toMatch(/Fraunces\(\{[^}]*variable: "--font-fraunces"/);
    expect(light["--font-display"]).toMatch(/^var\(--font-fraunces\),.*serif$/);
  });

  it("sets page titles in the display family", () => {
    expect(css).toMatch(/\.text-title,\s*\.text-large-title\s*\{[^}]*font-family:\s*var\(--font-display\)/);
  });
});

describe("icon set", () => {
  it("draws the app icon on the brand pine", () => {
    expect(readFileSync(join(root, "public/icons/app-icon.svg"), "utf8").toLowerCase()).toContain("#1f3b38");
  });

  it("ships a favicon in ICO format", () => {
    const path = join(root, "src/app/favicon.ico");
    expect(existsSync(path)).toBe(true);
    const header = readFileSync(path).subarray(0, 4);
    expect([...header]).toEqual([0, 0, 1, 0]);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the light/dark token sets in globals.css: WCAG contrast for every text pair the UI uses,
// 3:1 for essential non-text boundaries, and the two dark blocks (system + explicit) staying identical.

const css = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

function block(startMarker: RegExp): string {
  const start = css.search(startMarker);
  if (start < 0) throw new Error(`block not found: ${startMarker}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const rootVars = vars(block(/^:root \{/m));
const light: Record<string, string> = { ...rootVars, ...vars(block(/^@theme \{/m)) };
const systemDark = vars(block(/:root:not\(\[data-theme="light"\]\) \{/));
const explicitDark = vars(block(/^:root\[data-theme="dark"\] \{/m));
const dark: Record<string, string> = { ...light, ...explicitDark };

type Rgb = [number, number, number];

function parse(color: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(color);
  if (rgb) return { rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], alpha: Number(rgb[4]) };
  throw new Error(`unsupported color ${color}`);
}

function over(color: string, backdrop: Rgb): Rgb {
  const { rgb, alpha } = parse(color);
  return rgb.map((v, i) => v * alpha + backdrop[i] * (1 - alpha)) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const textPairs: Array<[string, string]> = [
  ["--color-ink", "--color-canvas"],
  ["--color-ink", "--color-surface"],
  ["--color-ink", "--color-surface-muted"],
  ["--color-ink-muted", "--color-canvas"],
  ["--color-ink-muted", "--color-surface"],
  ["--color-ink-muted", "--color-surface-muted"],
  ["--color-on-action", "--color-action"],
  ["--color-on-action", "--color-action-hover"],
  ["--color-on-action", "--color-destructive"],
  ["--color-destructive", "--color-surface"],
  ["--color-destructive", "--color-status-rejected-bg"],
  ["--color-status-pending", "--color-status-pending-bg"],
  ["--color-status-confirmed", "--color-status-confirmed-bg"],
  ["--color-status-rejected", "--color-status-rejected-bg"],
  ["--color-status-cancelled", "--color-status-cancelled-bg"],
  ["--color-status-completed", "--color-status-completed-bg"],
  // Emerald accent: navy label on the fill (rest + hover), emerald text/icons on page surfaces,
  // and text on the selected-row tint.
  ["--color-on-accent", "--color-accent"],
  ["--color-on-accent", "--color-accent-hover"],
  ["--color-accent-ink", "--color-surface"],
  ["--color-accent-ink", "--color-canvas"],
  ["--color-accent-ink", "--color-accent-soft"],
  ["--color-on-accent-soft", "--color-accent-soft"],
];

const nonTextPairs: Array<[string, string]> = [
  ["--color-field-border", "--color-surface"],
  ["--color-field-border", "--color-surface-muted"],
  ["--color-focus", "--color-canvas"],
  ["--color-focus", "--color-surface"],
  ["--color-focus", "--color-surface-muted"],
  // Selected time-slot outline must read against the unselected slot fill.
  ["--color-accent-ink", "--color-surface-muted"],
];

function rgbOf(theme: Record<string, string>, name: string): Rgb {
  const value = theme[name];
  if (!value) throw new Error(`missing token ${name}`);
  return parse(value).rgb;
}

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s theme contrast", (_name, theme) => {
  it.each(textPairs)("%s on %s >= 4.5:1", (fg, bg) => {
    expect(contrast(rgbOf(theme, fg), rgbOf(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(nonTextPairs)("%s against %s >= 3:1", (fg, bg) => {
    expect(contrast(rgbOf(theme, fg), rgbOf(theme, bg))).toBeGreaterThanOrEqual(3);
  });

  it("ink and ink-muted stay >= 4.5:1 on glass over black or white content", () => {
    for (const backdrop of [[0, 0, 0], [255, 255, 255]] as Rgb[]) {
      const glass = over(theme["--glass-bg"], backdrop);
      expect(contrast(rgbOf(theme, "--color-ink"), glass)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgbOf(theme, "--color-ink-muted"), glass)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("dark tokens", () => {
  it("system and explicit dark blocks are identical", () => {
    expect(systemDark).toEqual(explicitDark);
  });

  it("every light color token has a dark value", () => {
    const lightColors = Object.keys(light).filter((k) => k.startsWith("--color-"));
    expect(lightColors.filter((k) => !(k in explicitDark))).toEqual([]);
  });

  it("week-view staff tints keep ink text >= 4.5:1", () => {
    for (let i = 1; i <= 6; i++) {
      expect(contrast(rgbOf(dark, "--color-ink"), rgbOf(dark, `--staff-${i}-bg`))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const publicDir = join(process.cwd(), "public");

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
type Manifest = {
  id?: string;
  scope?: string;
  start_url?: string;
  lang?: string;
  display?: string;
  name?: string;
  short_name?: string;
  icons: ManifestIcon[];
};

function readText(relative: string): string {
  // Strip a UTF-8 BOM if present (sw.js keeps one).
  return readFileSync(join(publicDir, relative), "utf8").replace(/^﻿/, "");
}

const manifest = JSON.parse(readText("manifest.json")) as Manifest;
const swSource = readText("sw.js");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngHeader(relative: string) {
  const buffer = readFileSync(join(publicDir, relative));
  return {
    signatureOk: buffer.subarray(0, 8).equals(PNG_SIGNATURE),
    firstChunkType: buffer.subarray(12, 16).toString("ascii"),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer.readUInt8(25),
  };
}

/**
 * Returns the minimum alpha value of a non-interlaced 8-bit PNG.
 * Color types without alpha (0, 2, 3) are reported as fully opaque (255).
 */
function minAlpha(relative: string): number {
  const buffer = readFileSync(join(publicDir, relative));
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  const interlace = buffer.readUInt8(28);
  if (colorType !== 4 && colorType !== 6) return 255;
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG layout: depth ${bitDepth}, interlace ${interlace}`);
  }

  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 2;
  const stride = width * bpp;
  let previous = new Uint8Array(stride);
  let min = 255;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + 1 + x];
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = previous[x];
      const c = x >= bpp ? previous[x - bpp] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error(`Unknown PNG filter ${filter}`);
      }
      row[x] = (value + predictor) & 0xff;
    }
    for (let x = bpp - 1; x < stride; x += bpp) min = Math.min(min, row[x]);
    previous = row;
  }
  return min;
}

function publicPath(src: string): string {
  return src.replace(/^\//, "");
}

function extractSetLiteral(name: string): string[] {
  const match = swSource.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!match) throw new Error(`${name} not found in sw.js`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const pngIconPaths = extractSetLiteral("PNG_ICON_PATHS");
const allowedStaticLiteral = extractSetLiteral("ALLOWED_STATIC_PATHS");
const allowlistIncludesPngSpread =
  /const ALLOWED_STATIC_PATHS = new Set\(\[[\s\S]*?\.\.\.PNG_ICON_PATHS[\s\S]*?\]\);/.test(
    swSource,
  );
const effectiveAllowlist = new Set([
  ...allowedStaticLiteral,
  ...(allowlistIncludesPngSpread ? pngIconPaths : []),
]);

const pngManifestIcons = manifest.icons.filter((icon) => icon.type === "image/png");

describe("public/manifest.json", () => {
  it("declares a Turkish, root-scoped standalone app identity", () => {
    expect(manifest.lang).toBe("tr");
    expect(manifest.id).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
  });

  it("has 192 and 512 any-purpose PNG icons and a 512 maskable PNG", () => {
    const has = (sizes: string, purpose: string) =>
      pngManifestIcons.some(
        (icon) => icon.sizes === sizes && (icon.purpose ?? "any").split(" ").includes(purpose),
      );
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
  });

  it("keeps the SVG icon", () => {
    expect(manifest.icons.some((icon) => icon.src === "/icons/app-icon.svg")).toBe(true);
  });

  it.each(manifest.icons.map((icon) => [icon.src] as const))("icon file %s exists", (src) => {
    expect(existsSync(join(publicDir, publicPath(src)))).toBe(true);
  });

  it.each(pngManifestIcons.map((icon) => [icon.src, icon.sizes] as const))(
    "PNG %s has a valid signature and IHDR matching %s",
    (src, sizes) => {
      const header = readPngHeader(publicPath(src));
      expect(header.signatureOk).toBe(true);
      expect(header.firstChunkType).toBe("IHDR");
      expect(`${header.width}x${header.height}`).toBe(sizes);
    },
  );
});

describe("public/icons/icon-maskable-512.png", () => {
  it("has a full-bleed opaque background", () => {
    expect(minAlpha("icons/icon-maskable-512.png")).toBe(255);
  });
});

describe("public/icons/apple-touch-icon-180.png", () => {
  it("is a 180x180 PNG", () => {
    const header = readPngHeader("icons/apple-touch-icon-180.png");
    expect(header.signatureOk).toBe(true);
    expect(header.firstChunkType).toBe("IHDR");
    expect(header.width).toBe(180);
    expect(header.height).toBe(180);
  });

  it("is fully opaque (iOS renders transparency as black)", () => {
    expect(minAlpha("icons/apple-touch-icon-180.png")).toBe(255);
  });
});

describe("public/sw.js (static analysis, not executed)", () => {
  it("allowlists every manifest icon path, the apple-touch icon and the manifest", () => {
    for (const icon of manifest.icons) {
      expect(effectiveAllowlist.has(icon.src), icon.src).toBe(true);
    }
    expect(effectiveAllowlist.has("/icons/apple-touch-icon-180.png")).toBe(true);
    expect(effectiveAllowlist.has("/manifest.json")).toBe(true);
  });

  it("checks the image/png content type for PNG icons", () => {
    expect(allowlistIncludesPngSpread).toBe(true);
    expect(swSource).toMatch(
      /PNG_ICON_PATHS\.has\(path\)\)\s*\{\s*return contentType === "image\/png";/,
    );
  });

  it("only allowlists the manifest and /icons/ paths, never /api", () => {
    for (const path of effectiveAllowlist) {
      expect(path.startsWith("/api"), path).toBe(false);
      expect(path === "/manifest.json" || path.startsWith("/icons/"), path).toBe(true);
    }
    expect(allowedStaticLiteral.join(" ")).not.toContain("/api");
    expect(pngIconPaths.join(" ")).not.toContain("/api");
  });

  it("keeps the non-GET, cross-origin, navigate, text/html and query-string guards", () => {
    expect(swSource).toContain('if (request.method !== "GET") return;');
    expect(swSource).toContain("if (url.origin !== self.location.origin) return;");
    expect(swSource).toContain('request.mode !== "navigate"');
    expect(swSource).toMatch(
      /!\(request\.headers\.get\("accept"\) \|\| ""\)\.includes\("text\/html"\)/,
    );
    expect(swSource).toContain('url.search === ""');
    expect(swSource).toContain("ALLOWED_STATIC_PATHS.has(url.pathname)");
    expect(swSource).toContain("if (!isAllowedStatic) return;");
  });

  it("uses cache v2 and lists v1 as legacy", () => {
    expect(swSource).toContain('const CACHE_NAME = "salon-saas-pwa-v2";');
    const legacy = swSource.match(/const LEGACY_CACHE_NAMES = \[([^\]]*)\];/);
    expect(legacy).not.toBeNull();
    const legacyNames = [...(legacy?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(legacyNames).toContain("salon-saas-pwa-v1");
    expect(legacyNames).not.toContain("salon-saas-pwa-v2");
  });
});

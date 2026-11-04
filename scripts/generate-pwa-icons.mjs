// Generates the PWA PNG icons in public/icons/ from the public/icons/app-icon.svg design.
//
// Usage: node scripts/generate-pwa-icons.mjs
//
// Dependency-free on purpose (node:zlib + node:fs only). The artwork below mirrors
// app-icon.svg (128x128 viewBox) and is rasterised with signed-distance shapes and
// 4x4 supersampling for anti-aliasing. If app-icon.svg changes, update ARTWORK here
// and re-run the script; the generated PNGs are committed.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const VIEWBOX = 128;
const SUPERSAMPLE = 4;
const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const GRADIENT_START = hex("#171717");
const GRADIENT_END = hex("#3f3f3f");
const DARK = hex("#171717");
const WHITE = hex("#ffffff");

const ARTWORK = {
  cornerRadius: 24,
  strokeHalfWidth: 3,
  rings: [
    { cx: 38, cy: 42, r: 14 },
    { cx: 82, cy: 42, r: 14 },
  ],
  lines: [
    { x1: 48, y1: 74, x2: 72, y2: 74 },
    { x1: 48, y1: 86, x2: 66, y2: 86 },
  ],
  dot: { cx: 60, cy: 96, outer: 16, inner: 8 },
};

/**
 * background:
 *  - "rounded": transparent outside a rounded-rect gradient tile (same as the SVG)
 *  - "full-gradient": opaque full-bleed gradient (apple-touch-icon; iOS applies its own mask)
 *  - "full-solid": opaque full-bleed #171717 (maskable)
 * artworkScale: glyph scale around the centre (maskable keeps it inside the 80% safe zone).
 */
const ICONS = [
  { file: "icon-192.png", size: 192, background: "rounded", artworkScale: 1 },
  { file: "icon-512.png", size: 512, background: "rounded", artworkScale: 1 },
  { file: "icon-maskable-512.png", size: 512, background: "full-solid", artworkScale: 0.8 },
  { file: "apple-touch-icon-180.png", size: 180, background: "full-gradient", artworkScale: 1 },
];

function hex(value) {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const dx = Math.max(radius - x, 0, x - (size - radius));
  const dy = Math.max(radius - y, 0, y - (size - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(px, py, { x1, y1, x2, y2 }) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / lengthSquared));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

/** Returns [r, g, b, a] (a in 0..1) for one sample point in viewBox units. */
function sample(x, y, icon) {
  let color = null;

  if (icon.background === "rounded") {
    if (insideRoundedRect(x, y, VIEWBOX, ARTWORK.cornerRadius)) {
      color = mix(GRADIENT_START, GRADIENT_END, (x + y) / (2 * VIEWBOX));
    }
  } else if (icon.background === "full-gradient") {
    color = mix(GRADIENT_START, GRADIENT_END, Math.max(0, Math.min(1, (x + y) / (2 * VIEWBOX))));
  } else {
    color = DARK;
  }

  // Glyph coordinates: scale around the viewBox centre.
  const centre = VIEWBOX / 2;
  const gx = centre + (x - centre) / icon.artworkScale;
  const gy = centre + (y - centre) / icon.artworkScale;
  const half = ARTWORK.strokeHalfWidth;

  const onStroke =
    ARTWORK.rings.some(({ cx, cy, r }) => Math.abs(Math.hypot(gx - cx, gy - cy) - r) <= half) ||
    ARTWORK.lines.some((line) => distanceToSegment(gx, gy, line) <= half);
  if (onStroke) color = WHITE;

  const dotDistance = Math.hypot(gx - ARTWORK.dot.cx, gy - ARTWORK.dot.cy);
  if (dotDistance <= ARTWORK.dot.outer) color = DARK;
  if (dotDistance <= ARTWORK.dot.inner) color = WHITE;

  return color ? [color[0], color[1], color[2], 1] : [0, 0, 0, 0];
}

function render(icon) {
  const { size } = icon;
  const pixels = Buffer.alloc(size * size * 4);
  const unit = VIEWBOX / size;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) * unit;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) * unit;
          const [cr, cg, cb, ca] = sample(x, y, icon);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / samples) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); // width
  header.writeUInt32BE(size, 4); // height
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const icon of ICONS) {
  const png = encodePng(icon.size, render(icon));
  writeFileSync(join(OUTPUT_DIR, icon.file), png);
  console.log(`wrote public/icons/${icon.file} (${icon.size}x${icon.size}, ${png.length} bytes)`);
}

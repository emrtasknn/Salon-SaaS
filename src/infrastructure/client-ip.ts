import { isIP } from "node:net";

/**
 * Trusted client IP for rate limiting (WP-5).
 *
 * Only the header named by the deploy setting TRUSTED_IP_HEADER is read, and
 * only for platforms that overwrite it. Unknown/unset mode, a missing header or
 * an invalid value → null (callers skip IP buckets; never pool into one key).
 * IPv6 is reduced to its /64 prefix; IPv4-mapped IPv6 is treated as IPv4.
 */

export type HeadersLike = { get(name: string): string | null };

export const TRUSTED_IP_HEADER_MODES = ["x-vercel-forwarded-for", "x-forwarded-for", "cf-connecting-ip"] as const;
export type TrustedIpHeaderMode = (typeof TRUSTED_IP_HEADER_MODES)[number];

function isMode(mode: string | undefined): mode is TrustedIpHeaderMode {
  return mode !== undefined && (TRUSTED_IP_HEADER_MODES as ReadonlyArray<string>).includes(mode);
}

/** Expands a valid IPv6 string into 8 16-bit groups (handles "::" and a dotted IPv4 tail). */
function expandIpv6(address: string): number[] | null {
  let tail: number[] = [];
  let head = address;
  const lastColon = address.lastIndexOf(":");
  const last = address.slice(lastColon + 1);
  if (last.includes(".")) {
    if (isIP(last) !== 4) return null;
    const o = last.split(".").map(Number);
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    head = address.slice(0, lastColon + 1);
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => parseInt(g, 16)));
  let groups: number[];
  if (head.includes("::")) {
    const [left, right] = head.split("::");
    const l = parse(left);
    const r = parse(right);
    const missing = 8 - tail.length - l.length - r.length;
    if (missing < 0) return null;
    groups = [...l, ...new Array<number>(missing).fill(0), ...r, ...tail];
  } else {
    groups = [...parse(head), ...tail];
  }
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/** Normalises one IP literal to the rate-limit subject; null when invalid. */
export function normalizeIpSubject(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;
  const groups = expandIpv6(value.split("%")[0].toLowerCase());
  if (!groups) return null;
  const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isV4Mapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return groups.slice(0, 4).map((g) => g.toString(16)).join(":") + "::/64";
}

export function getClientIp(headers: HeadersLike, mode: string | undefined = process.env.TRUSTED_IP_HEADER): string | null {
  const normalizedMode = mode?.trim().toLowerCase();
  if (!isMode(normalizedMode)) return null;
  const raw = headers.get(normalizedMode);
  if (!raw) return null;
  // Forwarded-for style headers: the left-most entry is the original client.
  const first = normalizedMode === "cf-connecting-ip" ? raw : raw.split(",")[0];
  return normalizeIpSubject(first);
}

/** Reads the trusted client IP from the current request (server actions / RSC). */
export async function readClientIp(): Promise<string | null> {
  const { headers } = await import("next/headers");
  return getClientIp(await headers());
}

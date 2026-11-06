/**
 * Optional service price (owner decision 2026-11-06). Stored in kuruş (TRY minor units) so
 * there is no floating point. Display only: there is no online payment.
 */

/** 100.000,00 TL; matches the DB CHECK "Service_priceMinor_range_check". */
export const SERVICE_PRICE_MAX_MINOR = 10_000_000;

export type ServicePrice = Readonly<{ priceMinor: number | null; priceIsFrom: boolean }>;

export function createServicePrice(priceMinor: unknown, priceIsFrom: unknown): ServicePrice {
  if (typeof priceIsFrom !== "boolean") throw new TypeError("Service price flag is invalid");
  if (priceMinor === null) {
    if (priceIsFrom) throw new TypeError("A starting price needs a price");
    return { priceMinor: null, priceIsFrom: false };
  }
  if (
    typeof priceMinor !== "number" || !Number.isInteger(priceMinor) ||
    priceMinor < 0 || priceMinor > SERVICE_PRICE_MAX_MINOR
  ) {
    throw new TypeError("Service price is invalid");
  }
  return { priceMinor, priceIsFrom };
}

/**
 * Reads a price typed by a Turkish user: "450", "450,50", "1.250", "1.250,75", "450 ₺", "450 TL".
 * A dot is a thousands separator when it forms 3-digit groups, otherwise a decimal point.
 * Returns kuruş, null for an empty field, or "INVALID".
 */
export function parseTryAmount(input: string): number | null | "INVALID" {
  const text = input.replace(/₺|tl/gi, "").replace(/\s+/g, "");
  if (text === "") return null;

  let whole: string;
  let fraction = "";
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) {
    const [w, f = ""] = text.split(",");
    whole = w.replaceAll(".", "");
    fraction = f;
  } else if (/^\d+(,\d{1,2})?$/.test(text)) {
    [whole, fraction = ""] = text.split(",");
  } else if (/^\d+\.\d{1,2}$/.test(text)) {
    [whole, fraction] = text.split(".");
  } else {
    return "INVALID";
  }

  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(minor) || minor > SERVICE_PRICE_MAX_MINOR) return "INVALID";
  return minor;
}

/** "₺450", "₺450,50", "₺1.250", "₺450 ve üzeri"; null when there is no price. */
export function formatServicePrice(priceMinor: number | null | undefined, priceIsFrom: boolean | undefined): string | null {
  if (priceMinor === null || priceMinor === undefined) return null;
  const whole = priceMinor % 100 === 0;
  const text = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(priceMinor / 100);
  return priceIsFrom ? `${text} ve üzeri` : text;
}

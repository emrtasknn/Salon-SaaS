// Display-only helpers for people's names. Never used for identity or authorization.

function words(name: string | null | undefined): string[] {
  return (name ?? "").trim().split(/\s+/).filter(Boolean);
}

/** Name used in "Merhaba, …": the first name, or title + first name ("Dr. Ayşe"). */
export function greetingName(displayName: string | null | undefined): string | null {
  const parts = words(displayName);
  if (parts.length === 0) return null;
  if (parts[0].endsWith(".") && parts.length > 1) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

/** Up to two initials (first and last word) with Turkish casing: "ışık inci" → "Iİ". */
export function initials(name: string | null | undefined): string {
  const parts = words(name);
  if (parts.length === 0) return "?";
  const picked = parts.length === 1 ? [parts[0]] : [parts[0], parts[parts.length - 1]];
  return picked.map((part) => [...part][0].toLocaleUpperCase("tr-TR")).join("");
}

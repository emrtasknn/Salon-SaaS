// Display-only phone formatting. The stored value is never changed.

/**
 * "+905050626252" → "+90 505 062 62 52", "05050626252" → "0505 062 62 52".
 * Numbers that are not Turkish 10-digit subscriber numbers come back trimmed and unchanged.
 */
export function formatPhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[\s().-]/g, "");
  const international = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  if (international) return `+90 ${international[1]} ${international[2]} ${international[3]} ${international[4]}`;
  const national = /^0(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  if (national) return `0${national[1]} ${national[2]} ${national[3]} ${national[4]}`;
  return trimmed;
}

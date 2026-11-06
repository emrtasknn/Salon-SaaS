export type SetupStep = Readonly<{ href: string; label: string; done: boolean }>;

/**
 * Steps a new salon needs before customers can book online, in the order they
 * depend on each other. A null count means the data failed to load; it counts
 * as done so the dashboard never nags because of a read error.
 */
export function setupSteps(input: {
  staffCount: number | null;
  serviceCount: number | null;
  openDays: number | null;
  legalMissing: boolean;
}): SetupStep[] {
  const has = (n: number | null) => n === null || n > 0;
  return [
    { href: "/admin/staff", label: "Personel ekleyin (ya da kendinizi hizmet veren olarak açın)", done: has(input.staffCount) },
    { href: "/admin/services", label: "Hizmet ekleyin", done: has(input.serviceCount) },
    { href: "/admin/hours", label: "Çalışma saatlerini girin", done: has(input.openDays) },
    { href: "/admin/salon", label: "Yasal bilgileri tamamlayın", done: !input.legalMissing },
  ];
}

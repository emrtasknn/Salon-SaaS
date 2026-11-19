// First-visit product tour content. Presentation only: a tour never grants access,
// changes data or decides what a user can see; every page authorizes itself.
//
// SECURITY: driver.js renders `title`/`description` with innerHTML. Keep them as static
// strings written here. Never interpolate tenant, staff or customer data into a step.

export const TOUR_IDS = ["admin", "staff"] as const;
export type TourId = (typeof TOUR_IDS)[number];

/** Value of a `data-tour` attribute on the page (or null for a centred step with no target). */
export type TourTarget = string | null;

export type TourStep = Readonly<{
  target: TourTarget;
  title: string;
  description: string;
}>;

/** `data-tour` value of a tab-bar link; the same item exists in the phone and desktop navs. */
export function navTourTarget(href: string): string {
  return `nav:${href}`;
}

export const adminTourSteps: readonly TourStep[] = [
  {
    target: null,
    title: "Hoş geldiniz",
    description: "Kısa bir turla yönetim ekranını tanıyalım. İstediğiniz an kapatabilirsiniz.",
  },
  {
    target: "setup",
    title: "Kurulum listesi",
    description: "Bu adımları tamamladığınızda müşterileriniz online randevu alabilir. Biten adımlar otomatik işaretlenir.",
  },
  {
    target: "today",
    title: "Bugün",
    description: "Günün randevu sayısı ve onay bekleyen talepler burada görünür.",
  },
  {
    target: navTourTarget("/admin/calendar"),
    title: "Takvim",
    description: "Tüm personelin randevularını görün, yeni randevu ekleyin, talepleri onaylayın.",
  },
  {
    target: navTourTarget("/admin/customers"),
    title: "Müşteriler",
    description: "Müşteri listeniz, geçmiş randevular ve notlar.",
  },
  {
    target: "business",
    title: "İşletme",
    description: "Personel, hizmetler, çalışma saatleri ve işletme bilgilerinizi buradan yönetin.",
  },
  {
    target: "account",
    title: "Ayarlar",
    description: "Görünüm ve bildirimler burada. Bu turu Ayarlar'dan istediğiniz zaman tekrar izleyebilirsiniz.",
  },
];

export const staffTourSteps: readonly TourStep[] = [
  {
    target: null,
    title: "Hoş geldiniz",
    description: "Kısa bir turla ekranınızı tanıyalım. İstediğiniz an kapatabilirsiniz.",
  },
  {
    target: navTourTarget("/staff"),
    title: "Takvim",
    description: "Günlük randevularınızı buradan takip edin.",
  },
  {
    target: navTourTarget("/staff/appointments"),
    title: "Randevularım",
    description: "Size atanan randevuların listesi ve onay bekleyen talepler.",
  },
  {
    target: "account",
    title: "Ayarlar",
    description: "Bildirimleri açarak yeni randevulardan haberdar olun. Bu turu Ayarlar'dan tekrar izleyebilirsiniz.",
  },
];

export function tourSteps(id: TourId): readonly TourStep[] {
  return id === "admin" ? adminTourSteps : staffTourSteps;
}

/**
 * Steps that can be shown on the current page: centred steps always, targeted steps only
 * when their element is on screen (e.g. the setup list is gone once setup is complete).
 * Filtering up front keeps the "2 / 5" progress text honest.
 */
export function availableTourSteps(
  steps: readonly TourStep[],
  isPresent: (target: string) => boolean,
): TourStep[] {
  return steps.filter((step) => step.target === null || isPresent(step.target));
}

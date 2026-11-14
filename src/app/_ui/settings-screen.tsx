import type { BreadcrumbStep } from "@/components/ui/breadcrumb";
import { PageHeader } from "./page-header";
import { SettingsList } from "./settings-list";

/**
 * "Ayarlar" screen shared by the admin, staff and platform areas: same header, same rows, same
 * note. `home` is the area's first breadcrumb step. Presentation only: each page checks sign-in
 * before rendering it, and every action it reaches authorizes itself.
 */
export function SettingsScreen({ home, pushBindingKey }: { home: BreadcrumbStep; pushBindingKey?: string | null }) {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <PageHeader title="Ayarlar" breadcrumb={[home, { label: "Ayarlar" }]} />
      <div className="mx-auto w-full max-w-xl space-y-3 px-4 pb-10 pt-6 sm:px-6">
        <SettingsList pushBindingKey={pushBindingKey} />
        <p className="px-4 text-footnote text-ink-muted">Görünüm ve titreşim yalnızca bu cihazda saklanır.</p>
      </div>
    </main>
  );
}

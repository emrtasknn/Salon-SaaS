export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { readPushBindingKey } from "../../_ui/push-binding-key";
import { AdminSubpage } from "../admin-management";
import { SettingsList } from "./settings-list";

// Device settings only (appearance, vibration, notifications, password link); no tenant data.
// The key is a non-authoritative hint: its absence just means "not signed in".
export default async function AdminSettingsPage() {
  const pushBindingKey = await readPushBindingKey();
  if (!pushBindingKey) redirect("/login");
  return (
    <AdminSubpage title="Ayarlar">
      <SettingsList pushBindingKey={pushBindingKey} />
      <p className="px-4 text-footnote text-ink-muted">Görünüm ve titreşim yalnızca bu cihazda saklanır.</p>
    </AdminSubpage>
  );
}

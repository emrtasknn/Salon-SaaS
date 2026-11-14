export const dynamic = "force-dynamic";

import { House } from "lucide-react";
import { redirect } from "next/navigation";
import { readPushBindingKey } from "../../_ui/push-binding-key";
import { SettingsScreen } from "../../_ui/settings-screen";

// Device settings only (appearance, vibration, notifications, password link); no tenant data.
// The key is a non-authoritative hint: its absence just means "not signed in".
export default async function AdminSettingsPage() {
  const pushBindingKey = await readPushBindingKey();
  if (!pushBindingKey) redirect("/login");
  return <SettingsScreen home={{ label: "Yönetim", href: "/admin", icon: House }} pushBindingKey={pushBindingKey} />;
}

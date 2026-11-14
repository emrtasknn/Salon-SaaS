export const dynamic = "force-dynamic";

import { CalendarDays } from "lucide-react";
import { redirect } from "next/navigation";
import { readPushBindingKey } from "../../_ui/push-binding-key";
import { SettingsScreen } from "../../_ui/settings-screen";

// Same device settings as the admin area; no tenant data. The key is a non-authoritative hint:
// its absence just means "not signed in". The push actions authorize the profile themselves.
export default async function StaffSettingsPage() {
  const pushBindingKey = await readPushBindingKey();
  if (!pushBindingKey) redirect("/login");
  return <SettingsScreen home={{ label: "Takvim", href: "/staff", icon: CalendarDays }} pushBindingKey={pushBindingKey} />;
}

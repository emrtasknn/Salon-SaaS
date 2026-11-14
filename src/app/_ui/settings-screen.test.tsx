import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Building2 } from "lucide-react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }) }));
vi.mock("../push-actions", () => ({
  getWebPushConfigAction: async () => ({ enabled: false }),
  subscribeWebPushAction: async () => ({ status: "UNAUTHORIZED" }),
  unsubscribeWebPushAction: async () => ({ status: "UNAUTHORIZED" }),
}));

import { SettingsScreen } from "./settings-screen";

describe("SettingsScreen", () => {
  it("titles the page Ayarlar and links back to the area's home", () => {
    const html = renderToStaticMarkup(<SettingsScreen home={{ label: "İşletmeler", href: "/platform/tenants", icon: Building2 }} />);
    expect(html).toContain("data-page-header");
    expect(html).toMatch(/<h1[^>]*>Ayarlar<\/h1>/);
    expect(html).toContain('href="/platform/tenants"');
    expect(html).toContain("inset-group");
  });
});

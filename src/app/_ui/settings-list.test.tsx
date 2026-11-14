import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }) }));
vi.mock("../push-actions", () => ({
  getWebPushConfigAction: async () => ({ enabled: false }),
  subscribeWebPushAction: async () => ({ status: "UNAUTHORIZED" }),
  unsubscribeWebPushAction: async () => ({ status: "UNAUTHORIZED" }),
}));

import { SettingsList } from "./settings-list";
import { PushPermission } from "../pwa/push-permission";
import { AccountRows } from "./account-links";

describe("SettingsList", () => {
  const html = renderToStaticMarkup(<SettingsList pushBindingKey="k" />);

  it("lists appearance, vibration, notifications and password as rows of one group", () => {
    expect(html).toContain("inset-group");
    expect(html.match(/inset-row/g)).toHaveLength(4);
    for (const label of ["Görünüm", "Titreşim", "Bildirimler", "Şifremi değiştir"]) expect(html).toContain(label);
  });

  it("uses switches for vibration and notifications", () => {
    expect(html.match(/role="switch"/g)).toHaveLength(2);
  });

  it("links the password row to the reset page", () => {
    expect(html).toContain('href="/reset-password"');
  });
});

describe("SettingsList without a push binding (platform area)", () => {
  const html = renderToStaticMarkup(<SettingsList />);

  it("drops only the notifications row", () => {
    expect(html.match(/inset-row/g)).toHaveLength(3);
    expect(html).not.toContain("Bildirimler");
    for (const label of ["Görünüm", "Titreşim", "Şifremi değiştir"]) expect(html).toContain(label);
  });
});

describe("PushPermission layouts", () => {
  it("draws nothing compact on the home screen", () => {
    expect(renderToStaticMarkup(<PushPermission bindingKey="k" layout="banner-only" />)).toBe("");
  });

  it("is always a labelled switch row in settings, disabled until the device state is known", () => {
    const html = renderToStaticMarkup(<PushPermission bindingKey="k" layout="row" />);
    expect(html).toMatch(/<input[^>]*role="switch"[^>]*disabled/);
    expect(html).toContain("Bildirimler");
  });
});

describe("AccountRows", () => {
  const html = renderToStaticMarkup(<AccountRows settingsHref="/admin/settings" />);

  it("offers settings and log out as two list rows", () => {
    expect(html.match(/inset-row/g)).toHaveLength(2);
    expect(html).toContain('href="/admin/settings"');
    expect(html).toContain("Ayarlar");
    expect(html).toMatch(/<button[^>]*>.*Çıkış yap/);
  });
});

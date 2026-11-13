import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/calendar", useRouter: () => ({ push: vi.fn() }) }));

import { AppNavShell } from "./app-nav";
import { adminNavItems } from "./nav-items";

describe("AppNavShell tab bar", () => {
  const html = renderToStaticMarkup(
    <AppNavShell items={adminNavItems} label="Yönetim menüsü">
      <main>içerik</main>
    </AppNavShell>,
  );
  const tabBar = html.slice(html.indexOf("data-app-tabbar"));

  it("shows an icon and a label on every tab", () => {
    expect(tabBar.match(/<svg /g)).toHaveLength(adminNavItems.length);
    for (const item of adminNavItems) expect(tabBar).toContain(item.label);
  });

  it("marks the current tab for assistive tech and draws the sliding indicator only there", () => {
    expect(tabBar).toMatch(/href="\/admin\/calendar"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/calendar"/);
    expect(tabBar.match(/data-nav-pill/g)).toHaveLength(1);
    expect(tabBar.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("renders one glass lens, hidden from assistive tech and from pointers", () => {
    expect(tabBar.match(/data-nav-lens/g)).toHaveLength(1);
    expect(tabBar).toMatch(/<span[^>]*data-nav-lens[^>]*>/);
    const lens = tabBar.match(/<span[^>]*data-nav-lens[^>]*>/)![0];
    expect(lens).toContain('aria-hidden="true"');
    expect(lens).toContain("pointer-events-none");
  });

  it("keeps the page content", () => {
    expect(html).toContain("<main>içerik</main>");
  });
});

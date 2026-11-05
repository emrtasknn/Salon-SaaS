import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("./actions", () => ({ createTenantAction: vi.fn(), setTenantStatusAction: vi.fn() }));
vi.mock("../../_ui/account-links", () => ({ AccountLinks: () => null }));

import { PlatformTenantsView } from "./platform-tenants-view";
import { filterTenants } from "./tenant-status-list";

const tenants = [
  { id: "t1", slug: "kuafor-ayse", name: "Kuaför Ayşe", status: "ACTIVE" as const },
  { id: "t2", slug: "berber-ismail", name: "İsmail Berber", status: "INACTIVE" as const },
  { id: "t3", slug: "guzellik-merkezi", name: "Güzellik Merkezi", status: "ACTIVE" as const },
];

describe("filterTenants", () => {
  it("returns all salons for an empty query", () => {
    expect(filterTenants(tenants, "  ")).toHaveLength(3);
  });

  it("matches by name with Turkish case folding", () => {
    expect(filterTenants(tenants, "İSMAİL").map((t) => t.id)).toEqual(["t2"]);
    expect(filterTenants(tenants, "ayşe").map((t) => t.id)).toEqual(["t1"]);
  });

  it("matches by slug, with or without a leading slash", () => {
    expect(filterTenants(tenants, "guzellik").map((t) => t.id)).toEqual(["t3"]);
    expect(filterTenants(tenants, "/berber").map((t) => t.id)).toEqual(["t2"]);
  });

  it("returns nothing when no salon matches", () => {
    expect(filterTenants(tenants, "yok-boyle")).toHaveLength(0);
  });
});

describe("PlatformTenantsView", () => {
  it("puts the header and 'Yeni salon' before the list and keeps the form in a modal dialog", () => {
    const html = renderToStaticMarkup(<PlatformTenantsView tenants={tenants} />);
    const header = html.indexOf("Yeni salon");
    const list = html.indexOf("Kuaför Ayşe");
    const dialog = html.indexOf("<dialog");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(list);
    expect(list).toBeLessThan(dialog);
    expect(html).toMatch(/<dialog[^>]*aria-modal="true"/);
    // The existing provisioning fields are unchanged and live inside the dialog.
    const dialogHtml = html.slice(dialog);
    for (const name of ["name", "slug", "timezone", "firstAdminDisplayName", "firstAdminEmail", "firstAdminPassword", "firstAdminPhone"]) {
      expect(dialogHtml).toContain(`name="${name}"`);
    }
  });

  it("shows search, count and Aktif/Pasif badges with toggles", () => {
    const html = renderToStaticMarkup(<PlatformTenantsView tenants={tenants} />);
    expect(html).toContain('type="search"');
    expect(html).toContain("3 salon");
    expect(html).toContain("Aktif");
    expect(html).toContain("Pasif");
    expect(html).toContain("Pasife al");
    expect(html).toContain("Aktifleştir");
  });

  it("explains an empty list and points to 'Yeni salon'", () => {
    const html = renderToStaticMarkup(<PlatformTenantsView tenants={[]} />);
    expect(html).toContain("Henüz salon yok");
    expect(html).not.toContain('type="search"');
  });

  it("shows a load error but still offers 'Yeni salon'", () => {
    const html = renderToStaticMarkup(<PlatformTenantsView tenants={null} />);
    expect(html).toContain("Salon listesi yüklenemedi.");
    expect(html).toContain("Yeni salon");
  });
});

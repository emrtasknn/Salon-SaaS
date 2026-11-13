import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("is one sticky layer with breadcrumb, title and accessory", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Personel" breadcrumb={[{ label: "Yönetim", href: "/admin" }, { label: "Personel" }]} accessory={<span>zil</span>} />,
    );
    expect(html).toMatch(/<header[^>]*class="[^"]*sticky top-0/);
    expect(html).toContain('aria-label="Konum"');
    expect(html).toMatch(/<h1[^>]*>Personel<\/h1>/);
    expect(html).toContain("<span>zil</span>");
  });

  it("wraps a long title onto two lines instead of cutting it off", () => {
    const html = renderToStaticMarkup(<PageHeader title="Merhaba, RandevuN Test Yöneticisi" />);
    expect(html).toMatch(/<h1[^>]*class="[^"]*line-clamp-2/);
    expect(html).not.toMatch(/<h1[^>]*class="[^"]*\btruncate\b/);
  });
});

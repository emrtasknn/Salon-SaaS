import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Bone, SkeletonList, SkeletonScreen, SkeletonSlots } from "./skeleton";

describe("skeletons", () => {
  it("announce loading once and hide the placeholder blocks from assistive tech", () => {
    const html = renderToStaticMarkup(
      <SkeletonScreen title="Müşteriler">
        <SkeletonList rows={3} />
      </SkeletonScreen>,
    );
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain("Yükleniyor…");
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/<h1[^>]*>Müşteriler<\/h1>/);
    expect(html.match(/inset-row/g)).toHaveLength(3);
  });

  it("does not render an empty heading when the title is unknown", () => {
    const html = renderToStaticMarkup(<SkeletonScreen eyebrow accessory><Bone /></SkeletonScreen>);
    expect(html).not.toContain("<h1");
  });

  it("draws one chip per slot", () => {
    const html = renderToStaticMarkup(<SkeletonSlots count={6} />);
    expect(html.match(/skeleton-block/g)).toHaveLength(6);
    expect(html).toContain('aria-hidden="true"');
  });
});

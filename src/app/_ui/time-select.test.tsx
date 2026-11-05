import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { minuteOptions, TimeSelect } from "./time-select";

describe("TimeSelect", () => {
  it("offers quarter hours only", () => {
    expect(minuteOptions(30)).toEqual([0, 15, 30, 45]);
  });

  it("keeps an off-grid stored minute so saving does not change it", () => {
    expect(minuteOptions(5)).toEqual([0, 5, 15, 30, 45]);
  });

  it("posts HH:MM through a hidden input with the field name", () => {
    const html = renderToStaticMarkup(<TimeSelect name="openTime" label="Pazartesi açılış" defaultMinute={9 * 60 + 30} />);
    expect(html).toContain('type="hidden" name="openTime" value="09:30"');
    expect(html).toContain('aria-label="Pazartesi açılış saat"');
    expect(html).toContain('aria-label="Pazartesi açılış dakika"');
    expect(html.match(/<option value="\d+"/g)?.length).toBe(24 + 4);
  });
});

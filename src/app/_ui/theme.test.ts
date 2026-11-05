import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  applyThemePreference,
  parseThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
  themeInitScript,
  writeThemePreference,
} from "./theme";
import { ThemeToggle } from "./theme-toggle";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
  };
}

describe("theme preference helpers", () => {
  it("parses only light/dark; everything else is system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("DARK")).toBe("system");
  });

  it("reads and writes the stored preference; system clears the key", () => {
    const storage = memoryStorage();
    expect(readThemePreference(storage)).toBe("system");
    writeThemePreference("dark", storage);
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference(storage)).toBe("dark");
    writeThemePreference("system", storage);
    expect(storage.data.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it("falls back to system when storage is missing or throws", () => {
    expect(readThemePreference(null)).toBe("system");
    const throwing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(readThemePreference(throwing)).toBe("system");
    expect(() => writeThemePreference("dark", throwing)).not.toThrow();
  });

  it("applies light/dark as data-theme and removes it for system", () => {
    const root = fakeRoot();
    applyThemePreference("dark", root);
    expect(root.attrs.get("data-theme")).toBe("dark");
    applyThemePreference("light", root);
    expect(root.attrs.get("data-theme")).toBe("light");
    applyThemePreference("system", root);
    expect(root.attrs.has("data-theme")).toBe(false);
  });

  it("inline init script reads the same key and only pins light/dark", () => {
    expect(themeInitScript).toContain(JSON.stringify(THEME_STORAGE_KEY));
    const root = fakeRoot();
    const run = (stored: string | null) => {
      root.attrs.clear();
      new Function("localStorage", "document", themeInitScript)(
        { getItem: () => stored },
        { documentElement: root },
      );
      return root.attrs.get("data-theme");
    };
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBe("light");
    expect(run(null)).toBeUndefined();
    expect(run("bogus")).toBeUndefined();
  });
});

describe("ThemeToggle", () => {
  const html = renderToStaticMarkup(createElement(ThemeToggle));

  it("renders a labelled 3-state group with System pressed by default on the server", () => {
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Görünüm"');
    expect(html.match(/<button type="button"/g)?.length).toBe(3);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Sistem/);
    expect(html).toContain("Açık");
    expect(html).toContain("Koyu");
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(2);
  });

  it("uses 44px targets", () => {
    expect(html.match(/min-h-11 min-w-11/g)?.length).toBe(3);
  });
});

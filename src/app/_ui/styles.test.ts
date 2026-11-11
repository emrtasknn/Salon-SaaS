import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkboxClassName, switchClassName } from "./styles";

describe("switchClassName", () => {
  it("draws the thumb with a fixed light token, not the theme surface", () => {
    // `surface` is dark in the dark theme, which made the thumb read as "off" on a green track.
    expect(switchClassName).toContain("before:bg-switch-thumb");
    expect(switchClassName).not.toContain("before:bg-surface");
  });
});

describe("checkboxClassName", () => {
  it("replaces the browser's own box with token colors", () => {
    expect(checkboxClassName).toContain("appearance-none");
    expect(checkboxClassName).toContain("bg-surface");
    expect(checkboxClassName).toContain("checked:bg-action");
    expect(checkboxClassName).not.toMatch(/\baccent-/);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("native checkboxes", () => {
  it("always use the shared checkbox or switch recipe", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      let at = source.indexOf('type="checkbox"');
      while (at >= 0) {
        const start = source.lastIndexOf("<input", at);
        const end = source.indexOf("/>", at);
        const element = source.slice(start, end);
        if (!element.includes("checkboxClassName") && !element.includes("switchClassName")) {
          offenders.push(`${file.replace(process.cwd(), "")}:${source.slice(0, at).split("\n").length}`);
        }
        at = source.indexOf('type="checkbox"', at + 1);
      }
    }
    expect(offenders).toEqual([]);
  });
});

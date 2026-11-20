import { describe, expect, it } from "vitest";

import { withoutTrailingSlash } from "./trailing-slash";
import { isDavPath } from "./dav-path";

describe("trailing slash handling (Next default, moved into proxy for CalDAV)", () => {
  it("strips app paths like Next did", () => {
    expect(withoutTrailingSlash("/admin/")).toBe("/admin");
    expect(withoutTrailingSlash("/a/b//")).toBe("/a/b");
    expect(withoutTrailingSlash("/admin")).toBeNull();
    expect(withoutTrailingSlash("/")).toBeNull();
  });
  it("leaves CalDAV paths to the DAV handler", () => {
    expect(isDavPath("/dav/")).toBe(true);
    expect(isDavPath("/dav/u/x/cal/randevun/")).toBe(true);
    expect(isDavPath("/.well-known/caldav")).toBe(true);
    expect(isDavPath("/davetiye")).toBe(false);
  });
});

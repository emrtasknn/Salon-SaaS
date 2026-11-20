/** Path without its trailing slash(es), or null when it has none (or is the root). */
export function withoutTrailingSlash(pathname: string): string | null {
  if (pathname === "/" || !pathname.endsWith("/")) return null;
  return pathname.replace(/\/+$/, "") || "/";
}

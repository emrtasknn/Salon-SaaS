/** Paths answered by the RandevuN CalDAV account (handled in proxy.ts: Route Handlers cannot serve PROPFIND/REPORT). */
export function isDavPath(pathname: string): boolean {
  return pathname === "/.well-known/caldav" || pathname === "/dav" || pathname.startsWith("/dav/");
}

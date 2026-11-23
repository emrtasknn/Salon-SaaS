import { NextResponse, type NextRequest } from "next/server";

import { handleDavRequest } from "./src/app/dav-runtime";
import { isDavPath } from "./src/app/dav-path";
import { withoutTrailingSlash } from "./src/app/trailing-slash";
import { updateSupabaseSession } from "./src/infrastructure/auth/supabase-proxy";

/** WebDAV methods no app page uses. */
// OPTIONS too: calendar clients probe "/" for the DAV header before discovery.
const DAV_ONLY_METHODS = new Set(["PROPFIND", "REPORT", "PROPPATCH", "OPTIONS"]);

export async function proxy(request: NextRequest) {
  // The raw path: request.nextUrl normalises trailing slashes away.
  const pathname = new URL(request.url).pathname;
  // ADR-045 phase C: the RandevuN CalDAV account. Answered here because Route Handlers only
  // accept GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS and CalDAV needs PROPFIND and REPORT.
  if (isDavPath(pathname)) return handleDavRequest(request);
  // Manual "CalDAV account" setup on iOS first asks the bare host ("/"): answer it as the DAV root.
  if (pathname === "/" && DAV_ONLY_METHODS.has(request.method.toUpperCase())) return handleDavRequest(request, "/dav/");
  // Next's default "/admin/" → "/admin" redirect, turned off in next.config.ts for CalDAV.
  const stripped = withoutTrailingSlash(pathname);
  if (stripped !== null) {
    const url = new URL(request.url);
    url.pathname = stripped;
    return NextResponse.redirect(url, 308);
  }
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

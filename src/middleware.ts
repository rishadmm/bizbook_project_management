import { NextResponse, type NextRequest } from "next/server";

/** Edge-safe gate: only checks that an `ops_session` cookie exists. Real validation happens server-side (lib/auth.ts). */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // /p/** (subcontractor portal) is open at the edge: its own session (bbp_portal) is validated server-side by lib/portal-auth.ts.
  // /c/** (client portal) is open at the edge as well: its own session (bbp_client) is validated server-side by lib/client-portal-auth.ts.
  const open = pathname === "/login" || pathname === "/c" || pathname.startsWith("/c/") || pathname.startsWith("/portal/") || pathname === "/p" || pathname.startsWith("/p/") || pathname.startsWith("/api/files/");
  if (open || req.cookies.get("ops_session")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static assets (anything with a file extension).
  matcher: ["/((?!_next/|favicon.ico|.*\\..*).*)"],
};

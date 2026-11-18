import { NextResponse, type NextRequest } from "next/server";

/** Edge-safe gate: only checks that an `ops_session` cookie exists. Real validation happens server-side (lib/auth.ts). */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // /p/** (subcontractor portal) is open at the edge: its own session (bbp_portal) is validated server-side by lib/portal-auth.ts.
  // /suppliers/** (public supplier registration, sign-in and password reset) is public by design: the forms are honeypot + rate-limit protected server side.
  // /c/** (client portal) is open at the edge as well: its own session (bbp_client) is validated server-side by lib/client-portal-auth.ts.
  const open = pathname === "/login" || pathname === "/c" || pathname.startsWith("/c/") || pathname.startsWith("/portal/") || pathname === "/p" || pathname.startsWith("/p/") || pathname === "/suppliers" || pathname.startsWith("/suppliers/") || pathname.startsWith("/api/files/");
  if (open || req.cookies.get("ops_session")?.value) return NextResponse.next();
  // Prefer public host from the reverse proxy so redirects never leak the internal listen URL (e.g. localhost:3101).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) || "http";
  const url = host ? new URL(`${proto}://${host}/login`) : req.nextUrl.clone();
  if (!host) { url.pathname = "/login"; url.search = ""; }
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static assets (anything with a file extension).
  matcher: ["/((?!_next/|favicon.ico|.*\\..*).*)"],
};

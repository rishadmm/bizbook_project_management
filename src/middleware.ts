import { NextResponse, type NextRequest } from "next/server";

/** Edge-safe gate: only checks that an `ops_session` cookie exists. Real validation happens server-side (lib/auth.ts). */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const open = pathname === "/login" || pathname.startsWith("/portal/") || pathname.startsWith("/api/files/");
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

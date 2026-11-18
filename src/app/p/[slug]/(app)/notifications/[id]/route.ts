import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPortalSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/** GET /p/<slug>/notifications/<id>: marks the notification as read and goes to its destination (always inside the supplier's own portal). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  const s = await getPortalSession();
  const origin = new URL(req.url).origin;
  if (!s || s.sub.portal_slug !== slug) return NextResponse.redirect(new URL(`/p/${slug}/login`, origin));
  const n = getDb().prepare("SELECT id, href FROM portal_notifications WHERE id = ? AND subcontractor_id = ? AND (portal_user_id IS NULL OR portal_user_id = ?)").get(Number(id), s.sub.id, s.user.id) as { id: number; href: string | null } | undefined;
  if (!n) return NextResponse.redirect(new URL(`/p/${slug}`, origin));
  if (!s.readOnly) getDb().prepare("UPDATE portal_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?").run(new Date().toISOString(), n.id);
  const dest = n.href && n.href.startsWith(`/p/${slug}`) ? n.href : `/p/${slug}`;
  return NextResponse.redirect(new URL(dest, origin));
}

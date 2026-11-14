import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { can, getSession, isAdminUser } from "@/lib/auth";
import { logPortalEvent, portalAvailable, startPortalSession } from "@/lib/portal-auth";
import { ensureSlug } from "@/lib/portal-core";
import type { Subcontractor } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /subcontractors/:id/portal-view - read-only "view as subcontractor" for administrators (opened in a new tab by the Portal access tab).
 * Starts a 2 h impersonation portal session (no password involved), audited in portal_auth_events + the subcontractor activity feed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.must_change_password) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user;
  if (!isAdminUser(me) || !can(me, "subcontractors", "portal")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  const sub = Number.isInteger(id) ? (getDb().prepare("SELECT * FROM subcontractors WHERE id = ?").get(id) as Subcontractor | undefined) : undefined;
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!portalAvailable(sub)) return NextResponse.json({ error: "The portal is disabled for this subcontractor." }, { status: 409 });
  const slug = ensureSlug(getDb(), sub.id)!;
  await startPortalSession({ userId: null, subId: sub.id, remember: false, impersonatedBy: me.id });
  await logPortalEvent("impersonation_started", { subId: sub.id, email: me.email, detail: `${me.name} opened the portal in read-only admin view` });
  await logActivity("subcontractor", sub.id, "portal", `${me.name} viewed the portal as ${sub.name} (read only)`);
  return NextResponse.redirect(new URL(`/p/${slug}`, req.url), 303);
}

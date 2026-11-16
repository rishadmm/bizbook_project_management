import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { can, getSession, isAdminUser } from "@/lib/auth";
import { clientPortalAvailable, logClientEvent, startClientSession, type ClientRecord } from "@/lib/client-portal-auth";
import { ensureClientSlug } from "@/lib/client-portal-core";

export const dynamic = "force-dynamic";

/**
 * POST /clients/:id/portal-view - read-only "view as client" for administrators (opened in a new tab by the Portal access tab).
 * Starts a 2 h impersonation client session (no password involved), audited in client_auth_events + the project activity feed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.must_change_password) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = session.user;
  if (!isAdminUser(me) || !can(me, "clients", "portal")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  const db = getDb();
  const client = Number.isInteger(id) ? (db.prepare("SELECT id, name, type, contact_person, email, phone, portal_slug, portal_enabled, portal_show_subcontractors, portal_show_financials FROM clients WHERE id = ?").get(id) as ClientRecord | undefined) : undefined;
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!clientPortalAvailable(client)) return NextResponse.json({ error: "The portal is disabled for this client." }, { status: 409 });
  const slug = ensureClientSlug(db, client.id)!;
  await startClientSession({ userId: null, clientId: client.id, remember: false, impersonatedBy: me.id });
  await logClientEvent("impersonation_started", { clientId: client.id, email: me.email, detail: `${me.name} opened the portal in read-only admin view` });
  const p = db.prepare("SELECT id FROM projects WHERE client_id = ? ORDER BY id LIMIT 1").get(client.id) as { id: number } | undefined;
  if (p) await logActivity("project", p.id, "client_portal", `${me.name} viewed the client portal as ${client.name} (read only)`);
  return NextResponse.redirect(new URL(`/c/${slug}`, req.url), 303);
}

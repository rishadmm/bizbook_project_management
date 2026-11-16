import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPortalSession, portalOwnsAttachment } from "@/lib/portal-auth";
import { clientOwnsAttachment, getClientSession } from "@/lib/client-portal-auth";
import { resolvePortal } from "@/features/portal/queries";
import { UPLOAD_DIR } from "@/lib/files";
import type { Attachment } from "@/lib/types";

export const dynamic = "force-dynamic";

/** True when the attachment belongs to the (enabled) portal assignment identified by `token`. */
function portalOwnsFile(token: string, a: Attachment): boolean {
  const ctx = resolvePortal(token);
  if (!ctx) return false;
  const asg = ctx.assignment.id;
  const db = getDb();
  const table: Record<string, string> = { progress: "progress_reports", invoice: "sub_invoices", sub_invoice: "sub_invoices", certificate: "completion_certificates" };
  if (a.entity_type === "assignment") return a.entity_id === asg;
  const t = table[a.entity_type];
  if (!t) return false;
  return !!db.prepare(`SELECT 1 FROM ${t} WHERE id = ? AND assignment_id = ?`).get(a.entity_id, asg);
}

/** GET /api/files/:id -> file bytes (inline for images/pdf, `?download=1` forces download). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = getDb().prepare("SELECT * FROM attachments WHERE id = ?").get(Number(id)) as Attachment | undefined;
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Auth: a signed-in user (any signed-in user) OR a portal token for that assignment's files.
  const sp = new URL(req.url).searchParams;
  const session = await getSession();
  const portalToken = sp.get("portal");
  const internal = !!session && !session.user.must_change_password;
  let authorised = internal || (portalToken ? portalOwnsFile(portalToken, a) : false);
  if (!authorised) {
    // Separate portal login (bbp_portal): only files that belong to the signed-in company.
    const ps = await getPortalSession();
    if (ps && portalOwnsAttachment(ps, a)) authorised = true;
    // Client portal login (bbp_client): only files of verified progress reports and client-safe project files of that client's projects.
    const cs = authorised ? null : await getClientSession();
    if (cs && clientOwnsAttachment(cs, a)) authorised = true;
    if (!authorised && (ps || cs)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!authorised) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const full = path.join(UPLOAD_DIR, path.basename(a.stored_path));
  if (!fs.existsSync(full)) return NextResponse.json({ error: "File missing" }, { status: 404 });
  const buf = fs.readFileSync(full);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const inlineOk = /^(image\/|application\/pdf|text\/plain)/.test(a.mime ?? "");
  // Uploaded SVGs may carry scripts: serve them inline for <img>/lightbox use but sandboxed when opened directly.
  const extra: Record<string, string> = a.mime === "image/svg+xml" ? { "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox" } : {};
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": a.mime || "application/octet-stream",
      "Content-Length": String(buf.length),
      "Content-Disposition": `${download || !inlineOk ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "Cache-Control": internal ? "private, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDb } from "@/lib/db";
import { getPortalSession } from "@/lib/portal-auth";
import { portalCan } from "@/lib/portal-core";
import { getRfx } from "@/features/procurement/rfx-core";
import { awardLetterPdfData } from "@/features/procurement/pdf/build";
import { AwardLetterPdf } from "@/features/procurement/pdf/TenderPdfs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /p/:slug/tenders/:id/loa - the Letter of Award, only for the winning company of an awarded tender. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  const s = await getPortalSession();
  if (!s || s.sub.portal_slug !== slug || s.user.mustChange) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!portalCan(s.user.role, "tenders")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const r = getRfx(getDb(), Number(id));
  if (!r || r.entity_id !== s.entity.id || r.status !== "awarded" || !r.awarded_bid_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const win = getDb().prepare("SELECT subcontractor_id FROM rfx_bids WHERE id = ?").get(r.awarded_bid_id) as { subcontractor_id: number };
  if (win.subcontractor_id !== s.sub.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = awardLetterPdfData(r.id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await renderToBuffer(<AwardLetterPdf d={data} />);
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Length": String(buf.length), "Content-Disposition": `inline; filename="loa-${r.code}.pdf"`, "Cache-Control": "private, no-store" } });
}

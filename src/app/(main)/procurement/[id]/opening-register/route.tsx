import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { can, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRfx } from "@/features/procurement/rfx-core";
import { sealOf } from "@/features/procurement/bid-core";
import { openingPdfData } from "@/features/procurement/pdf/build";
import { OpeningRegisterPdf } from "@/features/procurement/pdf/TenderPdfs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /procurement/:id/opening-register (PDF; `?download=1` = attachment). Session, permission and country are validated here; the register only exists once the board has opened the bids. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.must_change_password) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.user, "procurement", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  const r = Number.isInteger(id) ? getRfx(getDb(), id) : undefined;
  if (!r || !session.user.entityIds.includes(r.entity_id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const seal = sealOf(getDb(), r);
  if (!seal.techOpen) return NextResponse.json({ error: "The bids are still sealed" }, { status: 409 });
  const data = openingPdfData(id);
  
  const buf = await renderToBuffer(<OpeningRegisterPdf d={data} />);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Length": String(buf.length), "Content-Disposition": `${download ? "attachment" : "inline"}; filename="opening-register-${r.code}.pdf"`, "Cache-Control": "private, no-store" } });
}

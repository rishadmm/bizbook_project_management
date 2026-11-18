import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { can, getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRfx } from "@/features/procurement/rfx-core";
import { awardLetterPdfData } from "@/features/procurement/pdf/build";
import { AwardLetterPdf } from "@/features/procurement/pdf/TenderPdfs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /procurement/:id/award-letter (PDF; `?download=1` = attachment). Session, permission and country are validated here; only for awarded tenders. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.must_change_password) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.user, "procurement", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  const r = Number.isInteger(id) ? getRfx(getDb(), id) : undefined;
  if (!r || !session.user.entityIds.includes(r.entity_id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r.status !== "awarded") return NextResponse.json({ error: "The tender is not awarded" }, { status: 409 });
  const data = awardLetterPdfData(id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await renderToBuffer(<AwardLetterPdf d={data} />);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Length": String(buf.length), "Content-Disposition": `${download ? "attachment" : "inline"}; filename="award-letter-${r.code}.pdf"`, "Cache-Control": "private, no-store" } });
}

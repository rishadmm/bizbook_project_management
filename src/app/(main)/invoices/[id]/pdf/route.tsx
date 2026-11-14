import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { can, getSession } from "@/lib/auth";
import { getInvoiceDetail } from "@/features/invoices/queries";
import { InvoicePdf } from "@/features/invoices/pdf/InvoicePdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /invoices/:id/pdf  (`?download=1` = attachment). Session is validated here (middleware only checks the cookie exists). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.must_change_password) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.user, "invoices", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  const detail = Number.isInteger(id) ? getInvoiceDetail(id) : null;
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const buf = await renderToBuffer(<InvoicePdf d={detail} generatedAt={generatedAt} />);
  const name = (detail.invoice.invoice_no ?? `invoice-${id}`).replace(/[^\w.\-]+/g, "_");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buf.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

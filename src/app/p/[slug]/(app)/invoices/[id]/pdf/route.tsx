import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getPortalSession } from "@/lib/portal-auth";
import { portalCan } from "@/lib/portal-core";
import { getInvoiceDetail } from "@/features/invoices/queries";
import { InvoicePdf } from "@/features/invoices/pdf/InvoicePdf";
import { ownedInvoiceId } from "@/features/portal/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /p/:slug/invoices/:id/pdf - portal session validated here; the invoice must belong to the session's company (else 404). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  const s = await getPortalSession();
  if (!s || s.user.mustChange) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.sub.portal_slug !== slug || !portalCan(s.user.role, "invoices")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const invId = ownedInvoiceId(s, Number(id));
  const d0 = invId ? getInvoiceDetail(invId) : null;
  if (!invId || !d0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = { ...d0, activity: [], trail: d0.trail.map((t) => ({ ...t, comment: null })) };
  const buf = await renderToBuffer(<InvoicePdf d={d} generatedAt={new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"} />);
  const name = (d.invoice.invoice_no ?? `invoice-${invId}`).replace(/[^\w.\-]+/g, "_");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/pdf", "Content-Length": String(buf.length), "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}.pdf"`, "Cache-Control": "private, no-store" },
  });
}

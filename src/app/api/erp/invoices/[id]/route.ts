import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth";
import { toErpPayload } from "@/features/invoices/erp";
import { getInvoiceDetail } from "@/features/invoices/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/erp/invoices/:id -> AP invoice payload (bizbook.ap_invoice.v1). Requires a valid session with invoices/view. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.user.must_change_password) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.user, "invoices", "view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = Number((await ctx.params).id);
  const detail = Number.isInteger(id) ? getInvoiceDetail(id, { hashes: true }) : null;
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toErpPayload(detail, { baseUrl: new URL(req.url).origin }), { headers: { "Cache-Control": "no-store" } });
}

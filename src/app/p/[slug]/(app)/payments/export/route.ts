import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { portalCan } from "@/lib/portal-core";
import { getPayments, getStatement, listAssignments } from "@/features/portal/data";

export const dynamic = "force-dynamic";
const q = (v: string | number | null | undefined) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** GET /p/:slug/payments/export - CSV of the statement + payment history of the signed-in company (session checked here). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const s = await getPortalSession();
  if (!s || s.user.mustChange) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.sub.portal_slug !== slug || !portalCan(s.user.role, "payments")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const want = Number(new URL(req.url).searchParams.get("assignment")) || undefined;
  const only = listAssignments(s).find((a) => a.id === want)?.id;
  const lines: string[] = [];
  lines.push("Statement of account", ["Subcontract", "Project", "Contract value", "Claimed", "Certified", "Retention held", "Advance recovered", "Net payable", "Paid", "Outstanding"].join(","));
  for (const r of getStatement(s, only)) lines.push([r.code, r.project, r.contractValue, r.claimed, r.certified, r.retention, r.advance, r.netPayable, r.paid, r.outstanding].map(q).join(","));
  lines.push("", "Payments", ["Date", "Invoice", "Your ref", "Subcontract", "Amount", "Method", "Reference"].join(","));
  for (const p of getPayments(s, only)) lines.push([p.date, p.invoiceNo, p.ref, p.assignmentCode, p.amount, p.method, p.paymentRef].map(q).join(","));
  return new NextResponse(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="statement-${slug}.csv"`, "Cache-Control": "private, no-store" } });
}

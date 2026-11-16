import { NextResponse } from "next/server";
import { clientPortalAvailable, getClientSession } from "@/lib/client-portal-auth";
import { issuesReport, monthlyReport, progressReport, scheduleReport, toCsv } from "@/features/client-portal/reports";

export const dynamic = "force-dynamic";

/** GET /c/:slug/reports/export?report=progress|schedule|issues|monthly&... -> CSV (read only; client + scope come from the session). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const s = await getClientSession();
  if (!s || s.user.mustChange || s.client.portal_slug !== slug || !clientPortalAvailable(s.client)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const g = (k: string) => q.get(k) ?? undefined;
  const kind = g("report");
  const table = kind === "progress" ? progressReport(s, g("project"), g("date")).table
    : kind === "schedule" ? scheduleReport(s, g("project")).table
    : kind === "issues" ? issuesReport(s, { project: g("project"), status: g("status"), resp: g("resp"), from: g("from"), to: g("to") }).table
    : kind === "monthly" ? monthlyReport(s, g("project"), g("month")).table : null;
  if (!table) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  return new NextResponse(toCsv(table), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}

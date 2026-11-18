import Link from "next/link";
import { Plus, Settings2 } from "lucide-react";
import { Badge, CardSection, EmptyState, LinkButton, PageHeader, Select, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR, Button } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { can, getActiveEntity, requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { RFX_STATUSES, countdown, formatLocal } from "@/lib/rfx";
import { statusLabel } from "@/lib/status";
import { listRfx, procurementUsers, projectOptions, rfxKpis, statusCounts } from "@/features/procurement/queries";

export const metadata = { title: "Procurement" };

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePage("procurement");
  const entity = await getActiveEntity();
  const sp = await searchParams;
  const status = RFX_STATUSES.find((s) => s === sp.status);
  const filters = { status, project: Number(sp.project) || undefined, category: Number(sp.category) || undefined, owner: Number(sp.owner) || undefined, q: sp.q?.trim() || undefined };
  const rows = listRfx(entity.id, filters);
  const counts = statusCounts(entity.id);
  const k = rfxKpis(entity.id);
  const cats = getDb().prepare("SELECT id, name FROM supplier_categories WHERE active = 1 AND (entity_id IS NULL OR entity_id = ?) ORDER BY sort").all(entity.id) as { id: number; name: string }[];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const qs = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const [a, b] of Object.entries({ ...sp, ...o })) if (b) u.set(a, b); const s = u.toString(); return `/procurement${s ? `?${s}` : ""}`; };
  return (
    <>
      <PageHeader title="Procurement" description={`Supplier tenders (RFx) of ${entity.country}: float, evaluate and award subcontracts to prequalified suppliers.`}
        actions={<>{can(me, "procurement", "setup") && <LinkButton href="/procurement/setup/templates" variant="secondary"><Settings2 size={15} />Templates</LinkButton>}
          {can(me, "procurement", "create") && <LinkButton href="/procurement/new" variant="primary"><Plus size={15} />New supplier tender</LinkButton>}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="rfx-kpis">
        <Stat label="Open tenders" value={k.open} hint="published, bidding open" />
        <Stat label="Closing in 7 days" value={k.closingSoon} tone={k.closingSoon ? "warn" : "default"} />
        <Stat label="Bids received" value={k.bids} hint="live tenders" />
        <Stat label="In evaluation" value={k.evaluation} hint="closed to recommended" />
        <Stat label="Award pending" value={k.awardPending} tone={k.awardPending ? "warn" : "default"} />
        <Stat label="Awarded this year" value={formatMoney(k.awardedValue, { compact: true, currency: k.currency })} hint={k.savingsPct === null ? `${k.awardedCount} tenders` : `${k.awardedCount} tenders · ${k.savingsPct.toFixed(1)}% under estimate`} tone="good" />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Status">
        <Link href={qs({ status: undefined })} className={cn("rounded-full px-3 py-1 text-xs font-bold", !status ? "bg-primary text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-primary-50")}>All <span className="ml-1 opacity-70">{total}</span></Link>
        {RFX_STATUSES.map((s) => (
          <Link key={s} href={qs({ status: s })} data-testid={`rfx-tab-${s}`} className={cn("rounded-full px-3 py-1 text-xs font-bold", status === s ? "bg-primary text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-primary-50")}>
            {statusLabel("rfxStatus", s)} <span className="ml-1 opacity-70">{counts[s] ?? 0}</span></Link>
        ))}
      </div>
      <form className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5" method="get">
        {status && <input type="hidden" name="status" value={status} />}
        <input name="q" defaultValue={sp.q} placeholder="Search code or title" className="rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-3 py-2 text-sm" />
        <Select name="project" defaultValue={sp.project ?? ""} placeholder="All projects" options={projectOptions(entity.id).map((p) => ({ value: p.id, label: `${p.code} ${p.name}`.slice(0, 48) }))} />
        <Select name="category" defaultValue={sp.category ?? ""} placeholder="All categories" options={cats.map((c) => ({ value: c.id, label: c.name }))} />
        <Select name="owner" defaultValue={sp.owner ?? ""} placeholder="All owners" options={procurementUsers(entity.id).map((u) => ({ value: u.id, label: u.name }))} />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <CardSection flush>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="No supplier tenders" description="Float a tender from a project stage, or create one here." /></div> : (
          <Table>
            <THead><TR><TH>Tender</TH><TH>Project / scope</TH><TH>Closing</TH><TH num>Bids</TH><TH>Status</TH><TH num>Estimate</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} data-testid={`rfx-row-${r.code}`}>
                  <TD className="min-w-[200px]"><Link href={`/procurement/${r.id}`} className="font-bold text-primary-dark hover:underline">{r.code}</Link><div className="max-w-[220px] truncate text-xs text-slate-500" title={r.title}>{r.title}</div>
                    <div className="mt-0.5 flex gap-1"><Badge tone={r.procedure === "open" ? "blue" : "violet"}>{r.procedure === "open" ? "Open" : "Selective"}</Badge></div></TD>
                  <TD className="whitespace-nowrap text-xs"><div className="font-semibold text-slate-700">{r.project_code} · {r.scope_kind === "stages" ? r.stage_codes ?? "—" : r.scope_kind === "subproject" ? "Sub-project" : "Whole project"}</div><div className="max-w-[170px] truncate text-slate-500" title={r.category_name ?? ""}>{r.category_name ?? "—"}</div></TD>
                  <TD className="whitespace-nowrap text-xs">{formatLocal(r.closing_at)}{["published", "scheduled"].includes(r.status) && <div className="text-slate-400">{countdown(r.closing_at)}</div>}</TD>
                  <TD num>{r.bids}</TD>
                  <TD><StatusBadge kind="rfxStatus" value={r.status} /></TD>
                  <TD num className="whitespace-nowrap">{formatMoney(r.estimate, { compact: true, currency: r.currency })}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}

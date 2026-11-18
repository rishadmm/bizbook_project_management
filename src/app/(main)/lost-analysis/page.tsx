import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { CardSection, Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { formatDate, formatMoney, pct } from "@/lib/format";
import { ENUMS, statusHex } from "@/lib/status";
import { listLosses, lossStats } from "@/features/lost-analysis/queries";
import { LossBar } from "@/features/lost-analysis/components/LossCharts";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { CHART } from "@/lib/theme";

export default async function LostAnalysisPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePage("lost_analysis");
  const entity = await getActiveEntity();
  const { q } = await searchParams;
  const rows = listLosses(entity.id);
  const s = lossStats(rows);
  const needle = (q ?? "").trim().toLowerCase();
  const lessons = rows.filter((r) => (r.lessons_learned || r.root_cause || r.action_items) &&
    (!needle || [r.tender_code, r.tender_title, r.client_name, r.winner_name, r.lessons_learned, r.root_cause, r.action_items, r.secondary_reasons, r.primary_reason].some((x) => (x ?? "").toLowerCase().includes(needle))));
  const reasonLabel = (r: string) => ENUMS.lossReason[r as keyof typeof ENUMS.lossReason]?.label ?? r;
  return (
    <>
      <PageHeader title="Loss analysis" description={`Why we lose bids, and what we learn from it · ${entity.country}.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lost tenders" value={s.total} />
        <Stat label="Open analyses" value={s.open} tone={s.open ? "warn" : "default"} hint="not yet closed" />
        <Stat label="Avg price gap" value={s.avgGap === null ? "-" : pct(s.avgGap)} hint="our price vs winner (+ = we were higher)" tone={s.avgGap !== null && s.avgGap > 0 ? "bad" : "default"} />
        <Stat label="Lost on price" value={s.priceLosses} hint={s.total ? `${pct((s.priceLosses / s.total) * 100, 0)} of losses` : undefined} />
      </div>
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <CardSection title="Losses by reason"><LossBar data={s.byReason.map((r) => ({ name: reasonLabel(r.reason), value: r.count, color: statusHex("lossReason", r.reason) }))} /></CardSection>
        <CardSection title="Losses by category"><LossBar data={s.byCategory.map((r) => ({ name: ENUMS.category[r.category as keyof typeof ENUMS.category]?.label ?? r.category, value: r.count, color: statusHex("category", r.category) }))} /></CardSection>
        <CardSection title="Average price gap by reason (%)"><LossBar unit="%" data={s.gapByReason.map((r) => ({ name: reasonLabel(r.reason), value: r.gap, color: r.gap > 0 ? CHART.negative : CHART.positive }))} /></CardSection>
      </div>

      <CardSection title="Loss register" flush className="mb-5">
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No lost tenders yet" /></div> : (
          <Table>
            <THead><TR><TH>Tender</TH><TH>Client</TH><TH>Decided</TH><TH>Primary reason</TH><TH>Winner</TH><TH num>Our price</TH><TH num>Winner price</TH><TH num>Gap</TH><TH>Owner</TH><TH>Status</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/lost-analysis/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.tender_code}</Link><div className="max-w-[220px] truncate text-xs text-slate-500">{r.tender_title}</div></TD>
                  <TD>{r.client_name ?? "-"}</TD><TD className="whitespace-nowrap">{formatDate(r.decided_at)}</TD>
                  <TD><StatusBadge kind="lossReason" value={r.primary_reason} /></TD><TD>{r.winner_name ?? "-"}</TD>
                  <TD num>{formatMoney(r.our_price)}</TD><TD num>{formatMoney(r.winner_price)}</TD>
                  <TD num className={r.price_gap_pct !== null && r.price_gap_pct > 0 ? "text-red-600" : ""}>{r.price_gap_pct === null ? "-" : `${r.price_gap_pct > 0 ? "+" : ""}${pct(r.price_gap_pct)}`}</TD>
                  <TD>{r.owner_name ?? "-"}</TD><TD><StatusBadge kind="lossStatus" value={r.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>

      <CardSection title="Lessons-learned library" subtitle={`${lessons.length} entr${lessons.length === 1 ? "y" : "ies"}`}
        actions={<form method="get" className="flex items-center gap-2"><div className="w-56"><Input name="q" defaultValue={q ?? ""} placeholder="Search lessons, causes, winners..." /></div><Button type="submit" size="sm"><Search size={14} />Search</Button></form>}>
        {lessons.length === 0 ? <EmptyState title="No lessons found" description={needle ? "Try a different search." : "Fill in lessons learned on a loss analysis to build the library."} /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {lessons.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2"><Link href={`/lost-analysis/${r.id}`} className="text-sm font-semibold text-blue-700 hover:underline">{r.tender_code}</Link><StatusBadge kind="lossReason" value={r.primary_reason} /><StatusBadge kind="category" value={r.tender_category} /></div>
                <div className="text-xs text-slate-500">{r.tender_title}{r.client_name ? ` · ${r.client_name}` : ""}</div>
                {r.root_cause && <p className="mt-2 text-sm text-slate-700"><b className="text-slate-900">Root cause:</b> {r.root_cause}</p>}
                {r.lessons_learned && <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700"><b className="text-slate-900">Lesson:</b> {r.lessons_learned}</p>}
                {r.action_items && <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700"><b className="text-slate-900">Actions:</b> {r.action_items}</p>}
              </Card>
            ))}
          </div>
        )}
      </CardSection>
    </>
  );
}

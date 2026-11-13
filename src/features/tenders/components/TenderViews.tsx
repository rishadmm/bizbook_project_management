import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Stat } from "@/components/ui/Stat";
import { Button, buttonClass } from "@/components/ui/Button";
import { Select, Input } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { countdownLabel, daysUntil, formatDate, formatMoney, pct } from "@/lib/format";
import { ENUMS, statusHex, statusOptions } from "@/lib/status";
import type { Client, User } from "@/lib/types";
import type { TenderFilters, TenderKpis, TenderRow } from "../queries";

export function KpiStrip({ k }: { k: TenderKpis }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Open bids" value={formatMoney(k.openValue, { compact: true })} hint={`${k.openCount} open tenders`} />
      <Stat label="Submitted" value={formatMoney(k.submittedValue, { compact: true })} hint={`${k.submittedCount} awaiting decision`} />
      <Stat label="Win rate (count)" value={k.winRateCount === null ? "-" : pct(k.winRateCount, 0)} hint={`${k.won} won / ${k.lost} lost`} tone={k.winRateCount !== null && k.winRateCount >= 50 ? "good" : "default"} />
      <Stat label="Win rate (value)" value={k.winRateValue === null ? "-" : pct(k.winRateValue, 0)} hint={`${formatMoney(k.wonValue, { compact: true })} won`} />
      <Stat label="Due in 7 days" value={k.due7} hint="pre-submission bids" tone={k.due7 > 0 ? "warn" : "default"} />
    </div>
  );
}

export function TenderFilterBar({ filters, view, clients, users }: { filters: TenderFilters; view: string; clients: Client[]; users: User[] }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <input type="hidden" name="view" value={view} />
      <div className="w-48"><Input name="q" placeholder="Search code, title, location" defaultValue={filters.q ?? ""} /></div>
      <div className="w-40"><Select name="status" defaultValue={filters.status ?? ""} placeholder="All statuses" options={statusOptions("tenderStatus")} /></div>
      <div className="w-36"><Select name="category" defaultValue={filters.category ?? ""} placeholder="All categories" options={statusOptions("category")} /></div>
      <div className="w-48"><Select name="client" defaultValue={filters.client ?? ""} placeholder="All clients" options={clients.map((c) => ({ value: c.id, label: c.name }))} /></div>
      <div className="w-40"><Select name="owner" defaultValue={filters.owner ?? ""} placeholder="All owners" options={users.map((u) => ({ value: u.id, label: u.name }))} /></div>
      <div className="w-36"><Select name="sort" defaultValue={filters.sort ?? "deadline"} options={[{ value: "deadline", label: "Sort: deadline" }, { value: "value", label: "Sort: value" }, { value: "probability", label: "Sort: probability" }, { value: "code", label: "Sort: newest" }]} /></div>
      <Button type="submit" variant="primary">Filter</Button>
      <Link href={`/tenders?view=${view}`} className={buttonClass("ghost")}>Reset</Link>
    </form>
  );
}

function deadlineTone(t: TenderRow): string {
  const d = daysUntil(t.submission_deadline);
  if (d === null || ["submitted", "negotiation", "won", "lost", "cancelled", "no_bid"].includes(t.status)) return "text-slate-500";
  return d < 0 ? "font-semibold text-red-600" : d <= 7 ? "font-semibold text-amber-600" : "text-slate-500";
}

export function KanbanBoard({ rows }: { rows: TenderRow[] }) {
  const cols = Object.keys(ENUMS.tenderStatus);
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {cols.map((s) => {
        const items = rows.filter((r) => r.status === s);
        const total = items.reduce((a, r) => a + r.value, 0);
        return (
          <div key={s} className="w-64 shrink-0 rounded-lg bg-slate-100/80 p-2">
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span className="h-2 w-2 rounded-full" style={{ background: statusHex("tenderStatus", s) }} />{ENUMS.tenderStatus[s as keyof typeof ENUMS.tenderStatus].label}
                <span className="rounded-full bg-white px-1.5 text-[10px] text-slate-500">{items.length}</span>
              </div>
              <span className="text-[11px] tabular-nums text-slate-500">{formatMoney(total, { compact: true })}</span>
            </div>
            <div className="space-y-2">
              {items.map((t) => (
                <Link key={t.id} href={`/tenders/${t.id}`} className="block rounded-md border border-slate-200 bg-white p-2.5 shadow-sm hover:border-blue-400">
                  <div className="flex items-center justify-between text-[11px] text-slate-500"><span className="font-medium">{t.code}</span><StatusBadge kind="category" value={t.category} /></div>
                  <div className="mt-1 line-clamp-2 text-sm font-medium text-slate-900">{t.title}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{t.client_name ?? "No client"}</div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-semibold tabular-nums text-slate-800">{formatMoney(t.value, { compact: true })}</span>
                    <span className="tabular-nums text-slate-500">{t.probability_pct !== null ? `${t.probability_pct}%` : ""}</span>
                  </div>
                  {t.submission_deadline && <div className={`mt-1 flex items-center gap-1 text-[11px] ${deadlineTone(t)}`}><CalendarClock size={12} />{formatDate(t.submission_deadline)} · {countdownLabel(t.submission_deadline)}</div>}
                </Link>
              ))}
              {items.length === 0 && <div className="py-4 text-center text-xs text-slate-400">No tenders</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TenderTable({ rows }: { rows: TenderRow[] }) {
  if (!rows.length) return <EmptyState title="No tenders match" description="Adjust the filters or create a new tender." />;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <Table>
        <THead><TR><TH>Code</TH><TH>Title</TH><TH>Client</TH><TH>Category</TH><TH>Status</TH><TH>Deadline</TH><TH num>Value</TH><TH num>Prob.</TH><TH>Owner</TH></TR></THead>
        <TBody>
          {rows.map((t) => (
            <TR key={t.id}>
              <TD className="whitespace-nowrap font-medium"><Link href={`/tenders/${t.id}`} className="text-blue-700 hover:underline">{t.code}</Link></TD>
              <TD className="max-w-xs truncate text-slate-900">{t.title}</TD>
              <TD className="max-w-[180px] truncate">{t.client_name ?? "-"}</TD>
              <TD><StatusBadge kind="category" value={t.category} /></TD>
              <TD><StatusBadge kind="tenderStatus" value={t.status} /></TD>
              <TD className="whitespace-nowrap"><div>{formatDate(t.submission_deadline)}</div><div className={`text-[11px] ${deadlineTone(t)}`}>{countdownLabel(t.submission_deadline)}</div></TD>
              <TD num>{formatMoney(t.value)}</TD>
              <TD num>{t.probability_pct !== null ? `${t.probability_pct}%` : "-"}</TD>
              <TD>{t.owner_name ?? "-"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

import Link from "next/link";
import { LayoutGrid, Map as MapIcon, Table2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, ProgressBar, Select, Stat, StatusBadge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import { formatDate, formatKm, formatMoney, formatNumber, pct } from "@/lib/format";
import { statusOptions } from "@/lib/status";
import { listProjects, listRegions, type ProjectListItem } from "@/features/projects/queries";
import { IndexChip, RagChip } from "@/features/projects/components/common";
import { portfolioFeatures, RAG_LEGEND } from "@/features/projects/components/mapfeatures";
import { barTone } from "@/features/projects/components/tabs1";
import { getActiveEntity, requirePage } from "@/lib/auth";

type SP = { status?: string; category?: string; region?: string; q?: string; view?: string };

function sizeLabel(p: ProjectListItem): string {
  if (p.lengthKm !== null) return formatKm(p.lengthKm);
  return p.total_quantity ? `${formatNumber(p.total_quantity)} ${p.quantity_unit ?? ""}` : "—";
}

function Card1({ p, child }: { p: ProjectListItem; child?: boolean }) {
  const m = p.metrics;
  return (
    <Link href={`/projects/${p.id}`} className={`block ${child ? "ml-5" : ""}`}>
      <Card className="p-4 transition hover:border-blue-300 hover:shadow">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500"><span className="font-semibold text-slate-700">{p.code}</span><StatusBadge kind="projectStatus" value={p.status} />{child && <Badge tone="slate">Sub of {p.parent_code}</Badge>}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-900">{p.name}</div>
            <div className="truncate text-xs text-slate-500">{p.client_name ?? "—"} · {p.region ?? "—"} · {sizeLabel(p)}</div>
          </div>
          <RagChip rag={m.rag} />
        </div>
        <div className="mt-3 space-y-2">
          <div>
            <div className="mb-0.5 flex justify-between text-xs text-slate-500"><span>Progress</span><span className="tabular-nums">Actual {pct(m.actualPct, 0)} · Planned {pct(m.plannedPct, 0)}</span></div>
            <ProgressBar value={m.actualPct} planned={m.plannedPct} tone={barTone(m.rag)} />
          </div>
          <div>
            <div className="mb-0.5 flex justify-between text-xs text-slate-500"><span>Cost</span><span className="tabular-nums">{formatMoney(m.ac, { compact: true })} of {formatMoney(m.bac, { compact: true })}</span></div>
            <ProgressBar value={m.bac ? (m.ac / m.bac) * 100 : 0} planned={m.actualPct} tone={m.ac > m.ev * 1.05 ? "red" : "slate"} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5"><IndexChip label="SPI" value={m.spi} /><IndexChip label="CPI" value={m.cpi} />
          {p.childCount > 0 && <Badge tone="slate">{p.childCount} sub-projects</Badge>}
          <span className="ml-auto text-xs text-slate-400">{formatDate(p.start_date)} → {formatDate(p.end_date)}</span></div>
      </Card>
    </Link>
  );
}

function Row({ p, child }: { p: ProjectListItem; child?: boolean }) {
  const m = p.metrics;
  return (
    <TR>
      <TD className={child ? "pl-8" : ""}>
        <Link href={`/projects/${p.id}`} className="font-medium text-blue-700 hover:underline">{child && <span className="mr-1 text-slate-300">└</span>}{p.code}</Link>
        <div className="text-xs text-slate-500">{p.name}</div>
      </TD>
      <TD>{p.client_name ?? "—"}</TD>
      <TD><StatusBadge kind="projectStatus" value={p.status} /></TD>
      <TD>{p.region ?? "—"}</TD>
      <TD num>{sizeLabel(p)}</TD>
      <TD className="w-44"><ProgressBar value={m.actualPct} planned={m.plannedPct} tone={barTone(m.rag)} showLabel /><div className="text-[10px] text-slate-400">planned {pct(m.plannedPct, 0)}</div></TD>
      <TD num>{formatMoney(m.ac, { compact: true })}<div className="text-xs text-slate-400">of {formatMoney(m.bac, { compact: true })}</div></TD>
      <TD><div className="flex gap-1"><IndexChip label="SPI" value={m.spi} /><IndexChip label="CPI" value={m.cpi} /></div></TD>
      <TD><RagChip rag={m.rag} /></TD>
    </TR>
  );
}

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("projects");
  const sp = await searchParams;
  const entity = await getActiveEntity();
  const all = listProjects(entity.id);
  const view = sp.view === "table" || sp.view === "map" ? sp.view : "cards";
  const q = (sp.q ?? "").toLowerCase();
  const filtered = all.filter((p) =>
    (!sp.status || p.status === sp.status) && (!sp.category || p.category === sp.category) && (!sp.region || p.region === sp.region) &&
    (!q || `${p.code} ${p.name} ${p.client_name ?? ""}`.toLowerCase().includes(q)));
  const ids = new Set(filtered.map((p) => p.id));
  const roots = filtered.filter((p) => !p.parent_id || !ids.has(p.parent_id));
  const kids = (id: number) => filtered.filter((p) => p.parent_id === id);

  const active = filtered.filter((p) => ["active", "mobilizing"].includes(p.status));
  const sum = (f: (p: ProjectListItem) => number) => filtered.filter((p) => !p.parent_id || true).reduce((a, p) => a + f(p), 0);
  const ev = sum((p) => p.metrics.ev), pv = sum((p) => p.metrics.pv), ac = sum((p) => p.metrics.ac);
  const critical = filtered.filter((p) => p.metrics.rag === "red").length;
  const qs = (v: string) => { const u = new URLSearchParams(); for (const [k, val] of Object.entries({ ...sp, view: v })) if (val) u.set(k, val); return `?${u.toString()}`; };

  return (
    <>
      <PageHeader title="Projects" description="Execution portfolio: progress, cost and schedule health." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Projects" value={filtered.length} hint={`${active.length} active`} />
        <Stat label="Contract value" value={formatMoney(sum((p) => p.contract_value), { compact: true })} />
        <Stat label="Portfolio SPI" value={pv > 0 ? (ev / pv).toFixed(2) : "—"} tone={pv > 0 ? (ev / pv >= 0.95 ? "good" : ev / pv >= 0.85 ? "warn" : "bad") : "default"} />
        <Stat label="Portfolio CPI" value={ac > 0 ? (ev / ac).toFixed(2) : "—"} tone={ac > 0 ? (ev / ac >= 0.95 ? "good" : ev / ac >= 0.85 ? "warn" : "bad") : "default"} />
        <Stat label="Critical" value={critical} tone={critical ? "bad" : "good"} hint="RAG red" />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search code, name, client…" className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        <Select name="status" defaultValue={sp.status ?? ""} options={statusOptions("projectStatus")} placeholder="All statuses" className="!w-40" />
        <Select name="category" defaultValue={sp.category ?? ""} options={statusOptions("category")} placeholder="All categories" className="!w-40" />
        <Select name="region" defaultValue={sp.region ?? ""} options={listRegions(entity.id).map((r) => ({ value: r, label: r }))} placeholder="All regions" className="!w-40" />
        <Button type="submit" variant="primary">Filter</Button>
        <Link href={`/projects?view=${view}`} className="px-1 py-2 text-sm text-slate-500 hover:underline">Clear</Link>
        <div className="ml-auto flex overflow-hidden rounded-md border border-slate-300 text-sm">
          {([["cards", "Cards", LayoutGrid], ["table", "Table", Table2], ["map", "Map", MapIcon]] as const).map(([k, label, Icon]) => (
            <Link key={k} href={`/projects${qs(k)}`} className={`flex items-center gap-1 px-3 py-2 ${view === k ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}><Icon size={14} />{label}</Link>
          ))}
        </div>
      </form>

      {filtered.length === 0 ? <EmptyState title="No projects match" description="Projects are created when a tender is marked Won." /> : view === "map" ? (
        <ProjectMapLazy features={portfolioFeatures(filtered)} legend={RAG_LEGEND} height={620} />
      ) : view === "table" ? (
        <Card>
          <Table>
            <THead><TR><TH>Project</TH><TH>Client</TH><TH>Status</TH><TH>Region</TH><TH num>Size</TH><TH>Progress</TH><TH num>Cost / budget</TH><TH>Indices</TH><TH>Health</TH></TR></THead>
            <TBody>{roots.map((p) => (<RowGroup key={p.id} p={p} kids={kids(p.id)} />))}</TBody>
          </Table>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roots.map((p) => (
            <div key={p.id} className="space-y-2">
              <Card1 p={p} />
              {kids(p.id).map((k) => <Card1 key={k.id} p={k} child />)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RowGroup({ p, kids }: { p: ProjectListItem; kids: ProjectListItem[] }) {
  return (<><Row p={p} />{kids.map((k) => <Row key={k.id} p={k} child />)}</>);
}

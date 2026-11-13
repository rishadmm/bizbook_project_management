import Link from "next/link";
import { LayoutGrid, Plus, Table2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkButton, buttonClass } from "@/components/ui/Button";
import { listTenders, lookups, tenderKpis, type TenderFilters } from "@/features/tenders/queries";
import { KanbanBoard, KpiStrip, TenderFilterBar, TenderTable } from "@/features/tenders/components/TenderViews";
import { requirePage } from "@/lib/auth";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function TendersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("tenders");
  const sp = await searchParams;
  const view = one(sp.view) === "table" ? "table" : "kanban";
  const filters: TenderFilters = { status: one(sp.status), category: one(sp.category), client: one(sp.client), owner: one(sp.owner), q: one(sp.q), sort: one(sp.sort) };
  const rows = listTenders(filters);
  const { clients, users } = lookups();
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  const toggle = (v: string) => `/tenders?${new URLSearchParams([...qs.entries(), ["view", v]]).toString()}`;
  return (
    <>
      <PageHeader title="Tenders" description="Pipeline from enquiry to award."
        actions={<>
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            <Link href={toggle("kanban")} className={`${buttonClass(view === "kanban" ? "primary" : "secondary")} rounded-none border-0`}><LayoutGrid size={14} />Kanban</Link>
            <Link href={toggle("table")} className={`${buttonClass(view === "table" ? "primary" : "secondary")} rounded-none border-0`}><Table2 size={14} />Table</Link>
          </div>
          <LinkButton href="/tenders/new" variant="primary"><Plus size={14} />New tender</LinkButton>
        </>} />
      <KpiStrip k={tenderKpis()} />
      <TenderFilterBar filters={filters} view={view} clients={clients} users={users} />
      {view === "kanban" ? <KanbanBoard rows={rows} /> : <TenderTable rows={rows} />}
    </>
  );
}

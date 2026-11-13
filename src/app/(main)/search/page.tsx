import Link from "next/link";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/Badge";
import { requirePage } from "@/lib/auth";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePage();
  const q = ((await searchParams).q ?? "").trim();
  const like = `%${q}%`;
  const db = getDb();
  const tenders = q ? db.prepare("SELECT id, code, title, status FROM tenders WHERE code LIKE ? OR title LIKE ? ORDER BY id DESC LIMIT 20").all(like, like) as { id: number; code: string; title: string; status: string }[] : [];
  const projects = q ? db.prepare("SELECT id, code, name, status FROM projects WHERE code LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 20").all(like, like) as { id: number; code: string; name: string; status: string }[] : [];
  const subs = q ? db.prepare("SELECT id, code, name, trade, status FROM subcontractors WHERE code LIKE ? OR name LIKE ? OR trade LIKE ? ORDER BY name LIMIT 20").all(like, like, like) as { id: number; code: string | null; name: string; trade: string | null; status: string }[] : [];
  const total = tenders.length + projects.length + subs.length;
  const Row = ({ href, code, name, badge }: { href: string; code?: string | null; name: string; badge: React.ReactNode }) => (
    <li><Link href={href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"><span className="text-sm"><span className="mr-2 font-mono text-xs text-slate-500">{code}</span>{name}</span>{badge}</Link></li>
  );
  return (
    <>
      <PageHeader title="Search" description={q ? `${total} result${total === 1 ? "" : "s"} for “${q}”` : "Type in the search box above."} />
      {q && total === 0 && <EmptyState title="No matches" description="Try a tender code, project name or subcontractor." />}
      <div className="space-y-4">
        {tenders.length > 0 && <CardSection title="Tenders" flush><ul className="divide-y divide-slate-100">{tenders.map((t) => <Row key={t.id} href={`/tenders/${t.id}`} code={t.code} name={t.title} badge={<StatusBadge kind="tenderStatus" value={t.status} />} />)}</ul></CardSection>}
        {projects.length > 0 && <CardSection title="Projects" flush><ul className="divide-y divide-slate-100">{projects.map((t) => <Row key={t.id} href={`/projects/${t.id}`} code={t.code} name={t.name} badge={<StatusBadge kind="projectStatus" value={t.status} />} />)}</ul></CardSection>}
        {subs.length > 0 && <CardSection title="Subcontractors" flush><ul className="divide-y divide-slate-100">{subs.map((t) => <Row key={t.id} href={`/subcontractors/${t.id}`} code={t.code} name={`${t.name}${t.trade ? " · " + t.trade : ""}`} badge={<StatusBadge kind="subcontractorStatus" value={t.status} />} />)}</ul></CardSection>}
      </div>
    </>
  );
}

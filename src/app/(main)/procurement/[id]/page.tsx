import { notFound } from "next/navigation";
import { PageHeader, StatusBadge, Tabs, resolveTab, type TabDef } from "@/components/ui";
import { requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertRecordAccess } from "@/lib/entity-context";
import EntityBar from "@/components/shell/EntityBar";
import { rfxHeader } from "@/features/procurement/queries";
import { internalBids } from "@/features/procurement/bid-core";
import { ActivityTab, AddendaTab, ApprovalsTab, AwardTab, ClarificationsTab, ComparisonTab, DocumentsTab, EvaluationTab, OpeningTab, OverviewTab, RequirementsTab, SuppliersTab } from "@/features/procurement/components/tabs";

export const metadata = { title: "Supplier tender" };

export default async function RfxDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage("procurement");
  const { id: sid } = await params;
  const r = rfxHeader(Number(sid));
  if (!r) notFound();
  const rec = await assertRecordAccess(r.entity_id);
  const db = getDb();
  const bids = internalBids(db, r.id).length;
  const clar = (db.prepare("SELECT COUNT(*) c FROM rfx_clarifications WHERE rfx_id = ?").get(r.id) as { c: number }).c;
  const tabs: TabDef[] = [
    { key: "overview", label: "Overview" }, { key: "requirements", label: "Requirements & BOQ" }, { key: "suppliers", label: "Suppliers" }, { key: "clarifications", label: "Clarifications", count: clar },
    { key: "addenda", label: "Addenda" }, { key: "opening", label: "Opening", count: bids }, { key: "evaluation", label: "Evaluation" }, { key: "comparison", label: "Comparison" },
    { key: "award", label: "Recommendation & award" }, { key: "approvals", label: "Approvals" }, { key: "documents", label: "Documents" }, { key: "activity", label: "Activity" },
  ];
  const tab = resolveTab(await searchParams, tabs, "overview");
  const ctx = { r, me, db };
  return (
    <>
      {rec.foreign && <EntityBar what="supplier tender" entityCode={rec.entity.code} entityName={rec.entity.short_name} activeName={rec.active.short_name} />}
      <PageHeader title={r.code} description={r.title} breadcrumbs={[{ label: "Procurement", href: "/procurement" }, { label: r.code }]} badges={<StatusBadge kind="rfxStatus" value={r.status} />} />
      <Tabs tabs={tabs} active={tab} basePath={`/procurement/${r.id}`} />
      {tab === "overview" && <OverviewTab {...ctx} />}
      {tab === "requirements" && <RequirementsTab {...ctx} />}
      {tab === "suppliers" && <SuppliersTab {...ctx} />}
      {tab === "clarifications" && <ClarificationsTab {...ctx} />}
      {tab === "addenda" && <AddendaTab {...ctx} />}
      {tab === "opening" && <OpeningTab {...ctx} />}
      {tab === "evaluation" && <EvaluationTab {...ctx} />}
      {tab === "comparison" && <ComparisonTab {...ctx} />}
      {tab === "award" && <AwardTab {...ctx} />}
      {tab === "approvals" && <ApprovalsTab {...ctx} />}
      {tab === "documents" && <DocumentsTab {...ctx} />}
      {tab === "activity" && <ActivityTab {...ctx} />}
    </>
  );
}

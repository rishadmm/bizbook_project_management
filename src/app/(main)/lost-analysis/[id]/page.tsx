import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { statusOptions } from "@/lib/status";
import { saveLossAnalysis } from "@/features/lost-analysis/actions";
import { allUsers, getLoss } from "@/features/lost-analysis/queries";
import { can, requirePage } from "@/lib/auth";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";

export default async function LossPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePage("lost_analysis");
  const { id: s } = await params;
  const id = Number(s);
  const l = Number.isInteger(id) ? getLoss(id) : undefined;
  if (!l) notFound();
  const users = allUsers();
  return (
    <>
      <PageHeader title={`Loss analysis - ${l.tender_code}`} breadcrumbs={[{ label: "Loss analysis", href: "/lost-analysis" }, { label: l.tender_code }]}
        badges={<StatusBadge kind="lossStatus" value={l.status} />}
        description={<>{l.tender_title} · <Link href={`/tenders/${l.tender_id}`} className="text-blue-700 hover:underline">open tender</Link></>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card className="p-5">
          <form action={saveLossAnalysis} className="space-y-4">
            <input type="hidden" name="id" value={l.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Primary reason"><Select name="primary_reason" defaultValue={l.primary_reason} options={statusOptions("lossReason")} /></Field>
              <Field label="Owner"><Select name="owner_id" defaultValue={l.owner_id ?? ""} placeholder="-" options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
              <Field label="Status"><Select name="status" defaultValue={l.status} options={statusOptions("lossStatus")} /></Field>
            </div>
            <Field label="Secondary reasons"><Input name="secondary_reasons" defaultValue={l.secondary_reasons ?? ""} placeholder="e.g. timeline, experience" /></Field>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Winner"><Input name="winner_name" defaultValue={l.winner_name ?? ""} /></Field>
              <Field label="Winner price"><Input name="winner_price" type="number" step="any" min="0" defaultValue={l.winner_price ?? ""} /></Field>
              <Field label="Our price"><Input name="our_price" type="number" step="any" min="0" defaultValue={l.our_price ?? ""} /></Field>
              <Field label="Technical score (0-100)"><Input name="technical_score" type="number" min="0" max="100" step="any" defaultValue={l.technical_score ?? ""} /></Field>
            </div>
            <p className="-mt-2 text-xs text-slate-400">Price gap % = (our price - winner price) / winner price; recalculated on save when both prices are set.</p>
            <Field label="Client feedback"><Textarea name="client_feedback" rows={3} defaultValue={l.client_feedback ?? ""} /></Field>
            <Field label="Root cause"><Textarea name="root_cause" rows={3} defaultValue={l.root_cause ?? ""} /></Field>
            <Field label="Lessons learned"><Textarea name="lessons_learned" rows={4} defaultValue={l.lessons_learned ?? ""} /></Field>
            <Field label="Action items"><Textarea name="action_items" rows={3} defaultValue={l.action_items ?? ""} /></Field>
            <div className="flex justify-end"><Button type="submit" variant="primary">Save analysis</Button></div>
          </form>
        </Card>
        <div className="space-y-5">
          <Card className="p-4 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Price gap</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${l.price_gap_pct !== null && l.price_gap_pct > 0 ? "text-red-600" : "text-slate-900"}`}>{l.price_gap_pct === null ? "-" : `${l.price_gap_pct > 0 ? "+" : ""}${l.price_gap_pct.toFixed(1)}%`}</div>
            <div className="text-xs text-slate-500">{l.client_name ?? "No client"}</div>
          </Card>
          <ApprovalPanel type="loss_analysis" documentId={l.id} path={`/lost-analysis/${l.id}`} user={me} title="Closure approval" canSubmit={can(me, "lost_analysis", "edit")} submitLabel="Submit closure for approval" />
          <AttachmentsPanel entityType="loss" entityId={l.id} revalidate={`/lost-analysis/${l.id}`} categories={["Debrief", "Evidence", "Other"]} />
          <ActivityTimeline entityType="loss" entityId={l.id} limit={20} />
        </div>
      </div>
    </>
  );
}

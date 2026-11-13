import Link from "next/link";
import { getDb } from "@/lib/db";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CardSection, Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ModalButton } from "@/components/ui/Modal";
import { Stat } from "@/components/ui/Stat";
import { StatusBadge } from "@/components/ui/Badge";
import { countdownLabel, daysUntil, formatDate, formatMoney, formatNumber, pct, todayISO } from "@/lib/format";
import { ENUMS, statusOptions } from "@/lib/status";
import type { Client, TenderRevision, User } from "@/lib/types";
import { markLost, markWon, transitionTender, updateTender, deleteTender } from "../actions";
import type { TenderDetail } from "../queries";
import { TenderForm } from "./TenderForm";

const STEPS = [
  ["draft", "Draft"], ["in_preparation", "Preparation"], ["under_review", "Review"], ["approved", "Approved"],
  ["submitted", "Submitted"], ["negotiation", "Negotiation"], ["outcome", "Won / Lost"],
] as const;

function Stepper({ status }: { status: string }) {
  const idx = status === "won" || status === "lost" ? 6 : STEPS.findIndex(([k]) => k === status);
  const closed = idx < 0;
  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      {STEPS.map(([k, label], i) => {
        const done = !closed && i < idx; const cur = !closed && i === idx;
        const lostFinal = cur && k === "outcome" && status === "lost";
        return (
          <li key={k} className="flex items-center">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${lostFinal ? "bg-red-600 text-white" : done ? "bg-emerald-500 text-white" : cur ? "bg-blue-600 text-white ring-4 ring-blue-100" : "bg-slate-200 text-slate-500"}`}>
              {done ? <Check size={13} /> : i + 1}
            </span>
            <span className={`ml-1.5 text-xs ${cur ? "font-semibold text-slate-900" : "text-slate-500"}`}>{cur && k === "outcome" ? ENUMS.tenderStatus[status as "won" | "lost"].label : label}</span>
            {i < STEPS.length - 1 && <span className={`mx-2 h-px w-6 sm:w-8 ${done ? "bg-emerald-400" : "bg-slate-200"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function Move({ id, to, label, variant = "secondary", extra }: { id: number; to: string; label: string; variant?: "primary" | "secondary" | "danger" | "success"; extra?: React.ReactNode }) {
  return (
    <form action={transitionTender} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="to" value={to} />
      {extra}
      <Button type="submit" variant={variant}>{label}</Button>
    </form>
  );
}

export function OverviewTab({ tender, revision, users, clients, currentUser, incompleteSections, totalSections }: {
  tender: TenderDetail; revision: TenderRevision | null; users: User[]; clients: Client[]; currentUser: User; incompleteSections: number; totalSections: number;
}) {
  const s = tender.status;
  const marginValue = revision ? revision.total_price - revision.total_cost : 0;
  const markup = revision && revision.total_cost > 0 ? (marginValue / revision.total_cost) * 100 : 0;
  const days = daysUntil(tender.submission_deadline);
  const isOpen = ["draft", "in_preparation", "under_review", "approved", "submitted", "negotiation"].includes(s);
  const price = revision?.total_price ?? 0;
  return (
    <div className="space-y-5">
      <Card className="p-4"><Stepper status={s} />{["cancelled", "no_bid"].includes(s) && <div className="mt-2 text-sm text-slate-600">This tender is closed: <StatusBadge kind="tenderStatus" value={s} /> on {formatDate(tender.decided_at)}.</div>}</Card>

      {isOpen && (
        <CardSection title="Workflow actions" subtitle="Moves follow the status machine; each step is logged.">
          <div className="flex flex-wrap items-start gap-3">
            {s === "draft" && <Move id={tender.id} to="in_preparation" label="Start preparation" variant="primary" />}
            {s === "in_preparation" && (
              <div className="flex flex-col gap-1">
                <Move id={tender.id} to="under_review" label="Send for review" variant="primary"
                  extra={incompleteSections > 0 && ["admin", "super_admin"].includes(currentUser.role) ? <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="override" />Admin override</label> : null} />
                {incompleteSections > 0 && <span className="text-xs text-amber-700">{incompleteSections} of {totalSections} department sections are not completed{["admin", "super_admin"].includes(currentUser.role) ? "" : " - complete them first"}.</span>}
              </div>
            )}
            {s === "under_review" && <span className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Awaiting department reviews (see Reviews tab).</span>}
            {s === "under_review" && <Move id={tender.id} to="in_preparation" label="Withdraw to preparation" />}
            {s === "approved" && <Move id={tender.id} to="submitted" label="Submit to client" variant="primary" />}
            {s === "approved" && <Move id={tender.id} to="in_preparation" label="Back to preparation" />}
            {s === "submitted" && <Move id={tender.id} to="negotiation" label="Move to negotiation" variant="primary" />}
            {(s === "submitted" || s === "negotiation") && (
              <>
                <ModalButton label="Mark Won" title={`Mark ${tender.code} as won`} variant="success">
                  <form action={markWon} className="space-y-3">
                    <input type="hidden" name="id" value={tender.id} />
                    <p className="text-xs text-slate-500">Creates a project with budget lines and stages from the final revision ({revision?.label}).</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={`Final contract value (our price ${revision ? formatMoney(price) : ""})`}><Input name="won_value" type="number" step="any" min="0" required defaultValue={Math.round(price) || tender.estimated_value || ""} /></Field>
                      <Field label="Award date"><Input name="award_date" type="date" defaultValue={todayISO()} required /></Field>
                      <Field label="Project start"><Input name="start_date" type="date" /></Field>
                      <Field label="Project end"><Input name="end_date" type="date" /></Field>
                    </div>
                    <Field label="Project manager"><Select name="manager_id" placeholder="- select -" options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
                    <div className="flex justify-end"><Button type="submit" variant="success">Mark won and create project</Button></div>
                  </form>
                </ModalButton>
                <ModalButton label="Mark Lost" title={`Mark ${tender.code} as lost`} variant="danger">
                  <form action={markLost} className="space-y-3">
                    <input type="hidden" name="id" value={tender.id} />
                    <Field label="Primary reason"><Select name="primary_reason" options={statusOptions("lossReason")} defaultValue="price" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Winner"><Input name="winner_name" /></Field>
                      <Field label="Winner price"><Input name="winner_price" type="number" step="any" min="0" /></Field>
                    </div>
                    <Field label="Decision date"><Input name="decided_at" type="date" defaultValue={todayISO()} /></Field>
                    <Field label="Client feedback"><Textarea name="client_feedback" rows={3} /></Field>
                    <div className="flex justify-end"><Button type="submit" variant="danger">Mark lost and open analysis</Button></div>
                  </form>
                </ModalButton>
              </>
            )}
            <div className="ml-auto flex gap-2">
              {s !== "submitted" && s !== "negotiation" && <Move id={tender.id} to="no_bid" label="No bid" />}
              <Move id={tender.id} to="cancelled" label="Cancel tender" variant="danger" />
            </div>
          </div>
        </CardSection>
      )}

      {s === "won" && tender.project_id && <Card className="flex items-center justify-between p-4"><span className="text-sm">Won at <b>{formatMoney(tender.won_value)}</b>. Project <b>{tender.project_code}</b> was created.</span><Link href={`/projects/${tender.project_id}`} className="text-sm font-medium text-blue-700 hover:underline">Open project</Link></Card>}
      {s === "lost" && <LossLink tenderId={tender.id} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={`Cost ${revision?.label ?? ""}`} value={formatMoney(revision?.total_cost)} />
        <Stat label="Price" value={formatMoney(price)} />
        <Stat label="Margin value" value={formatMoney(marginValue)} />
        <Stat label="Margin on price" value={pct(revision?.margin_pct)} hint="margin / price" />
        <Stat label="Markup on cost" value={pct(markup)} hint="margin / cost" />
      </div>

      <CardSection title="Details" actions={<div className="flex gap-2">
        <ModalButton label="Edit" title="Edit tender" size="sm" wide><TenderForm action={updateTender} tender={tender} clients={clients} users={users} submitLabel="Save changes" /></ModalButton>
        {s === "draft" && !tender.project_id && <form action={deleteTender}><input type="hidden" name="id" value={tender.id} /><Button type="submit" size="sm" variant="danger">Delete</Button></form>}
      </div>}>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <D k="Client" v={tender.client_name} /><D k="Type" v={ENUMS.tenderKind[tender.kind].label} /><D k="Category" v={ENUMS.category[tender.category].label} />
          <D k="Location" v={tender.location} /><D k="Quantity" v={tender.quantity ? `${formatNumber(tender.quantity, 2).replace(/\.00$/, "")} ${tender.quantity_unit ?? ""}` : null} /><D k="Owner" v={tender.owner_name} />
          <D k="Issue date" v={formatDate(tender.issue_date)} /><D k="Clarification deadline" v={formatDate(tender.clarification_deadline)} />
          <D k="Submission deadline" v={tender.submission_deadline ? `${formatDate(tender.submission_deadline)} (${countdownLabel(tender.submission_deadline)})` : "-"} warn={days !== null && days <= 7 && ["draft", "in_preparation", "under_review", "approved"].includes(s)} />
          <D k="Estimated value" v={formatMoney(tender.estimated_value)} /><D k="Bid bond" v={formatMoney(tender.bid_bond_amount)} /><D k="Win probability" v={tender.probability_pct !== null ? `${tender.probability_pct}%` : null} />
          <D k="Submitted" v={formatDate(tender.submitted_at)} /><D k="Decided" v={formatDate(tender.decided_at)} />
        </dl>
        {tender.scope_summary && <div className="mt-4"><div className="text-xs font-medium text-slate-500">Scope summary</div><p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">{tender.scope_summary}</p></div>}
      </CardSection>
    </div>
  );
}

function LossLink({ tenderId }: { tenderId: number }) {
  const l = getDb().prepare("SELECT id FROM loss_analyses WHERE tender_id = ? ORDER BY id DESC LIMIT 1").get(tenderId) as { id: number } | undefined;
  return <Card className="flex items-center justify-between p-4"><span className="text-sm">This tender was lost.</span>{l && <Link href={`/lost-analysis/${l.id}`} className="text-sm font-medium text-blue-700 hover:underline">Open loss analysis</Link>}</Card>;
}

function D({ k, v, warn }: { k: string; v: string | null | undefined; warn?: boolean }) {
  return <div><dt className="text-xs font-medium text-slate-500">{k}</dt><dd className={warn ? "font-semibold text-amber-600" : "text-slate-900"}>{v || "-"}</dd></div>;
}

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CardSection } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ModalButton } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatDate, formatDateTime, formatMoney, pct, todayISO } from "@/lib/format";
import { statusOptions } from "@/lib/status";
import type { TenderRevision } from "@/lib/types";
import { createRevision, deleteNegotiation, saveNegotiation, saveRevisionFeedback, submitRevision } from "../actions";
import type { MarginChangeRow, NegotiationRow, TenderDetail } from "../queries";
import { NegotiationChart, type NegPoint } from "./NegotiationChart";

function NegForm({ tender, revisions, n }: { tender: TenderDetail; revisions: TenderRevision[]; n?: NegotiationRow }) {
  return (
    <form action={saveNegotiation} className="space-y-3">
      <input type="hidden" name="tender_id" value={tender.id} />{n && <input type="hidden" name="id" value={n.id} />}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Date"><Input name="date" type="date" required defaultValue={n?.date ?? todayISO()} /></Field>
        <Field label="Channel"><Select name="channel" defaultValue={n?.channel ?? "meeting"} options={statusOptions("negotiationChannel")} /></Field>
        <Field label="Revision"><Select name="revision_id" defaultValue={n?.revision_id ?? tender.current_revision_id ?? ""} options={revisions.map((r) => ({ value: r.id, label: r.label ?? `R${r.rev_no}` }))} /></Field>
      </div>
      <Field label="Summary"><Textarea name="summary" rows={2} defaultValue={n?.summary ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client position"><Textarea name="client_position" rows={2} defaultValue={n?.client_position ?? ""} /></Field>
        <Field label="Our position"><Textarea name="our_position" rows={2} defaultValue={n?.our_position ?? ""} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Client target price"><Input name="client_target_price" type="number" step="any" min="0" defaultValue={n?.client_target_price ?? ""} /></Field>
        <Field label="Outcome"><Input name="outcome" defaultValue={n?.outcome ?? ""} /></Field>
        <Field label="Next step"><Input name="next_step" defaultValue={n?.next_step ?? ""} /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" variant="primary">Save</Button></div>
    </form>
  );
}

export function CommercialTab({ tender, revisions, negotiations, changes, currency }: {
  tender: TenderDetail; revisions: TenderRevision[]; negotiations: NegotiationRow[]; changes: MarginChangeRow[]; currency: string;
}) {
  const cur = revisions.find((r) => r.id === tender.current_revision_id);
  const canNew = ["submitted", "negotiation"].includes(tender.status) && cur && cur.status !== "draft";
  const canSubmitRev = ["submitted", "negotiation"].includes(tender.status) && cur?.status === "draft" && cur.rev_no > 0;
  const chart: NegPoint[] = negotiations.length
    ? negotiations.map((n) => ({ name: `${formatDate(n.date)} (${n.rev_label ?? "-"})`, ours: n.rev_price, target: n.client_target_price }))
    : revisions.map((r) => ({ name: r.label ?? `R${r.rev_no}`, ours: r.total_price, target: null }));
  return (
    <div className="space-y-5">
      <CardSection title="Revision comparison" flush actions={<div className="flex gap-2">
        {canSubmitRev && <form action={submitRevision}><input type="hidden" name="tender_id" value={tender.id} /><Button type="submit" size="sm" variant="primary">Submit {cur?.label} to client</Button></form>}
        {canNew && <ModalButton label="Create new revision" title="Create new revision" size="sm" variant="primary">
          <form action={createRevision} className="space-y-3">
            <input type="hidden" name="tender_id" value={tender.id} />
            <p className="text-xs text-slate-500">Copies all budget lines from {cur?.label}. The previous revision is superseded when the new one is submitted.</p>
            <Field label="Reason for revision"><Textarea name="reason" rows={3} required placeholder="e.g. Client requested 5% price reduction" /></Field>
            <div className="flex justify-end"><Button type="submit" variant="primary">Create</Button></div>
          </form>
        </ModalButton>}
      </div>}>
        <Table>
          <THead><TR><TH>Rev</TH><TH>Status</TH><TH>Reason</TH><TH num>Cost</TH><TH num>Price</TH><TH num title="Margin on price">Margin %</TH><TH num title="Markup on cost">Markup %</TH><TH num>Price delta</TH><TH>Submitted</TH><TH>Client feedback</TH></TR></THead>
          <TBody>
            {revisions.map((r, i) => {
              const prev = revisions[i - 1];
              const delta = prev ? r.total_price - prev.total_price : null;
              const markup = r.total_cost > 0 ? ((r.total_price - r.total_cost) / r.total_cost) * 100 : 0;
              return (
                <TR key={r.id} className={r.id === tender.current_revision_id ? "bg-blue-50/40" : ""}>
                  <TD className="font-semibold">{r.label}{r.id === tender.current_revision_id && <span className="ml-1 text-[10px] font-normal text-blue-600">current</span>}</TD>
                  <TD><StatusBadge kind="revisionStatus" value={r.status} /></TD>
                  <TD className="max-w-[220px] text-xs">{r.reason ?? "-"}</TD>
                  <TD num>{formatMoney(r.total_cost)}</TD><TD num className="font-medium">{formatMoney(r.total_price)}</TD>
                  <TD num>{pct(r.margin_pct)}</TD><TD num>{pct(markup)}</TD>
                  <TD num className={delta === null ? "" : delta < 0 ? "text-red-600" : "text-emerald-600"}>{delta === null ? "-" : `${delta > 0 ? "+" : ""}${formatMoney(delta)} (${prev.total_price ? pct((delta / prev.total_price) * 100) : "-"})`}</TD>
                  <TD>{formatDate(r.submitted_at)}</TD>
                  <TD className="min-w-[200px]">
                    <form action={saveRevisionFeedback} className="flex gap-1">
                      <input type="hidden" name="revision_id" value={r.id} />
                      <input name="client_feedback" defaultValue={r.client_feedback ?? ""} placeholder="Add feedback" className="w-full rounded border border-transparent px-1.5 py-1 text-xs hover:border-slate-300 focus:border-blue-500 focus:outline-none" />
                      <button className="text-xs text-blue-600 hover:underline">Save</button>
                    </form>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </CardSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <CardSection title="Client target vs our price" subtitle="Our price is the revision linked to each negotiation entry"><NegotiationChart data={chart} currency={currency} /></CardSection>
        <CardSection title="Margin change log" subtitle="Every margin edit with its reason" flush>
          {changes.length === 0 ? <div className="p-4"><EmptyState title="No margin changes yet" /></div> : (
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <THead><TR><TH>When</TH><TH>Rev</TH><TH>Line</TH><TH num>From</TH><TH num>To</TH><TH>Reason</TH><TH>By</TH></TR></THead>
                <TBody>
                  {changes.map((c) => (
                    <TR key={c.id}>
                      <TD className="whitespace-nowrap text-xs">{formatDateTime(c.created_at)}</TD><TD>{c.rev_label}</TD>
                      <TD className="max-w-[160px] truncate text-xs">{c.line_desc ?? "(deleted line)"}</TD>
                      <TD num>{c.old_margin !== null ? `${c.old_margin}%` : "-"}</TD><TD num className="font-medium">{c.new_margin !== null ? `${c.new_margin}%` : "-"}</TD>
                      <TD className="max-w-[200px] text-xs">{c.reason ?? "-"}</TD><TD className="text-xs">{c.user_name ?? "-"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardSection>
      </div>

      <CardSection title="Negotiation log" flush actions={<ModalButton label="Log negotiation" title="Log negotiation" size="sm" variant="primary" wide><NegForm tender={tender} revisions={revisions} /></ModalButton>}>
        {negotiations.length === 0 ? <div className="p-4"><EmptyState title="No negotiations logged" description="Record meetings, calls and client price targets here." /></div> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Channel</TH><TH>Rev</TH><TH>Summary</TH><TH>Client position</TH><TH>Our position</TH><TH num>Client target</TH><TH>Outcome / next</TH><TH className="w-28" /></TR></THead>
            <TBody>
              {negotiations.map((n) => (
                <TR key={n.id} className="align-top">
                  <TD className="whitespace-nowrap">{formatDate(n.date)}</TD><TD><StatusBadge kind="negotiationChannel" value={n.channel} /></TD><TD>{n.rev_label ?? "-"}</TD>
                  <TD className="max-w-[200px] text-xs">{n.summary}</TD><TD className="max-w-[180px] text-xs">{n.client_position}</TD><TD className="max-w-[180px] text-xs">{n.our_position}</TD>
                  <TD num>{n.client_target_price ? formatMoney(n.client_target_price) : "-"}</TD>
                  <TD className="max-w-[180px] text-xs">{n.outcome}{n.next_step && <div className="text-slate-500">Next: {n.next_step}</div>}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <ModalButton label="Edit" title="Edit negotiation" size="sm" wide><NegForm tender={tender} revisions={revisions} n={n} /></ModalButton>
                      <form action={deleteNegotiation}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="tender_id" value={tender.id} /><button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 size={14} /></button></form>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>
    </div>
  );
}

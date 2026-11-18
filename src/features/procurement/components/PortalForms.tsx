"use client";
import { useMemo, useState } from "react";
import ActionForm from "@/components/ActionForm";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { respondRequestAction, saveCommercialAction, saveTechnicalAction, submitBidAction, withdrawBidAction } from "../portal-actions";
import { bidTotals } from "@/lib/rfx";

const err = "text-sm font-semibold text-red-600";
export interface Req { id: number; name: string; kind: string; mandatory: number; instructions: string | null; value_text: string | null; value_number: number | null; filename: string | null }
export interface Line { id: number; item_no: string; description: string; unit: string | null; quantity: number; rate: number | null }

export function TechnicalForm({ rfxId, reqs, locked }: { rfxId: number; reqs: Req[]; locked: boolean }) {
  return (
    <ActionForm action={saveTechnicalAction} className="space-y-4" errorClassName={err}>
      <input type="hidden" name="rfx_id" value={rfxId} />
      {reqs.map((q) => (
        <div key={q.id} className="rounded-xl border border-line p-3" data-testid={`req-${q.id}`}>
          <div className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800">{q.name}<span className={q.mandatory ? "text-xs font-semibold text-red-600" : "text-xs font-semibold text-slate-400"}>{q.mandatory ? "mandatory" : "optional"}</span></div>
          {q.instructions && <p className="mb-2 text-xs text-slate-500">{q.instructions}</p>}
          {q.kind === "document" && <><input type="file" name={`file_${q.id}`} disabled={locked} className="text-sm" aria-label={q.name} />{q.filename && <span className="ml-2 text-xs text-emerald-700">Uploaded: {q.filename}</span>}</>}
          {q.kind === "text" && <Textarea name={`text_${q.id}`} rows={2} defaultValue={q.value_text ?? ""} disabled={locked} />}
          {q.kind === "number" && <Input type="number" step="any" name={`text_${q.id}`} defaultValue={q.value_number ?? ""} disabled={locked} className="!w-40" />}
          {q.kind === "date" && <Input type="date" name={`text_${q.id}`} defaultValue={q.value_text ?? ""} disabled={locked} className="!w-48" />}
          {q.kind === "yes_no" && <Select name={`text_${q.id}`} defaultValue={q.value_text ?? ""} placeholder="Choose" disabled={locked} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} className="!w-32" />}
        </div>))}
      {!locked && <Button type="submit" variant="primary" data-testid="save-technical">Save technical envelope</Button>}
    </ActionForm>
  );
}

/** Priced BOQ with live line amounts, subtotal, discount, VAT at the country rate and the total (3 decimals for OMR). */
export function CommercialForm({ rfxId, lines, currency, vatRate, dec, discount, deviations, alternative, validity, minValidity, bondRef, commercialReqs, locked }: {
  rfxId: number; lines: Line[]; currency: string; vatRate: number; dec: number; discount: number; deviations: string; alternative: string; validity: number | null; minValidity: number; bondRef: string;
  commercialReqs: Req[]; locked: boolean;
}) {
  const [rates, setRates] = useState<Record<number, string>>(Object.fromEntries(lines.map((l) => [l.id, l.rate === null ? "" : String(l.rate)])));
  const [disc, setDisc] = useState(String(discount || ""));
  const calc = useMemo(() => {
    const rows = lines.map((l) => ({ amount: (Number(rates[l.id]) || 0) * l.quantity }));
    return bidTotals(rows, Number(disc) || 0, vatRate, dec);
  }, [rates, disc, lines, vatRate, dec]);
  const f = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (
    <ActionForm action={saveCommercialAction} className="space-y-4" errorClassName={err}>
      <input type="hidden" name="rfx_id" value={rfxId} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-sm" data-testid="boq-table">
          <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit rate ({currency})</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
          <tbody className="divide-y divide-[#f1f5f9]">{lines.map((l) => (
            <tr key={l.id}><td className="px-3 py-2">{l.item_no}</td><td className="px-3 py-2">{l.description}</td><td className="px-3 py-2">{l.unit}</td><td className="px-3 py-2 text-right tabular-nums">{l.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
              <td className="px-3 py-1.5"><Input type="number" step="any" min={0} name={`rate_${l.id}`} value={rates[l.id]} onChange={(e) => setRates({ ...rates, [l.id]: e.target.value })} disabled={locked} className="!w-32 text-right" data-testid={`rate-${l.id}`} aria-label={`Rate ${l.item_no}`} /></td>
              <td className="px-3 py-2 text-right tabular-nums" data-testid={`amount-${l.id}`}>{f((Number(rates[l.id]) || 0) * l.quantity)}</td></tr>))}</tbody>
        </table>
      </div>
      <div className="ml-auto w-full max-w-sm space-y-1 rounded-xl border border-line p-4 text-sm" data-testid="bid-totals">
        <div className="flex justify-between"><span>Subtotal</span><b className="tabular-nums">{f(calc.subtotal)}</b></div>
        <div className="flex items-center justify-between gap-3"><span>Discount</span><Input type="number" step="any" min={0} name="discount" value={disc} onChange={(e) => setDisc(e.target.value)} disabled={locked} className="!w-32 text-right" /></div>
        <div className="flex justify-between"><span>Net total (excl. VAT)</span><b className="tabular-nums" data-testid="bid-net">{f(calc.net)}</b></div>
        <div className="flex justify-between text-slate-500"><span>VAT {vatRate}%</span><span className="tabular-nums">{f(calc.vat)}</span></div>
        <div className="flex justify-between border-t border-line pt-1 text-base"><span className="font-bold">Total incl. VAT ({currency})</span><b className="tabular-nums">{f(calc.gross)}</b></div>
      </div>
      {commercialReqs.map((q) => (
        <Field key={q.id} label={`${q.name}${q.mandatory ? " (mandatory)" : ""}`}><Select name={`text_${q.id}`} defaultValue={q.value_text ?? ""} placeholder="Choose" disabled={locked} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} className="!w-32" /></Field>))}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={`Bid validity (days, at least ${minValidity})`}><Input type="number" name="validity_days" defaultValue={validity ?? minValidity} disabled={locked} data-testid="validity" /></Field>
        <Field label="Bid bond reference"><Input name="bond_ref" defaultValue={bondRef} disabled={locked} /></Field>
        <Field label="Deviations from the tender conditions"><Textarea name="deviations" rows={2} defaultValue={deviations} disabled={locked} /></Field>
        <Field label="Alternative offer (optional)"><Textarea name="alternative" rows={2} defaultValue={alternative} disabled={locked} /></Field>
      </div>
      {!locked && <Button type="submit" variant="primary" data-testid="save-commercial">Save commercial envelope</Button>}
    </ActionForm>
  );
}

export function SubmitPanel({ rfxId, ready, submitted, revision }: { rfxId: number; ready: boolean; submitted: boolean; revision: number }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3">
      <ActionForm action={submitBidAction} errorClassName={err} className="space-y-3">
        <input type="hidden" name="rfx_id" value={rfxId} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="confirm-submit" className="mt-1" />
          <span>I confirm that the bid is complete, binding for the validity period and submitted on behalf of my company{submitted ? ` (this replaces revision ${revision})` : ""}.</span></label>
        <Button type="submit" variant="primary" disabled={!ready || !confirm} data-testid="submit-bid">{submitted ? "Submit revision" : "Submit bid"}</Button>
      </ActionForm>
      {submitted && <ActionForm action={withdrawBidAction} errorClassName={err}><input type="hidden" name="rfx_id" value={rfxId} /><Button type="submit" variant="danger" size="sm" data-testid="withdraw-bid">Withdraw bid</Button></ActionForm>}
    </div>
  );
}

export function RequestAnswer({ rfxId, req, lines, currency, dec }: { rfxId: number; req: { id: number; kind: string; message: string; due_at: string | null }; lines: Line[]; currency: string; dec: number }) {
  return (
    <ActionForm action={respondRequestAction} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4" errorClassName={err}>
      <input type="hidden" name="rfx_id" value={rfxId} /><input type="hidden" name="request_id" value={req.id} />
      <div className="text-sm font-bold text-slate-800">{req.kind === "bafo" ? "Revised price requested (BAFO)" : "Clarification requested"}</div><p className="text-sm text-slate-700">{req.message}</p>
      {req.kind === "bafo" && <div className="space-y-1">{lines.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{l.item_no} {l.description} <span className="text-xs text-slate-400">({l.quantity} {l.unit})</span></span><Input type="number" step="any" name={`rate_${l.id}`} defaultValue={l.rate ?? ""} className="!w-32 text-right" aria-label={`Revised rate ${l.item_no}`} /></label>)}<p className="text-xs text-slate-500">Rates in {currency}, {dec} decimals shown; your original prices stay on record.</p></div>}
      <Textarea name="response" rows={2} placeholder="Your answer" required /><input type="file" name="file" className="text-sm" />
      <Button type="submit" variant="primary" size="sm">Send answer</Button>
    </ActionForm>
  );
}

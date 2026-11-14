"use client";
import { AlertTriangle, Calculator, CalendarRange, Check, Circle, FileText, ListChecks, MapPin, Paperclip, Pencil, StickyNote, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useServerForm } from "@/components/useServerForm";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { addDays, formatMoney } from "@/lib/format";
import { deductions, type BoqItem } from "@/features/invoices/calc";
import { amountInWords } from "@/features/invoices/words";
import { submitInvoice, type WorkState } from "../work-actions";
import PortalAttachments, { type AttachState } from "./PortalAttachments";
import PortalLinesEditor, { type LineTotals } from "./PortalLinesEditor";

export interface InvoiceAsg {
  id: number; label: string; boq: BoqItem[]; code: string; projectCode: string; projectName: string; stageName: string | null;
  contractValue: number; retentionPct: number; advancePct: number; paymentDays: number; billedSubtotal: number; certifiedSubtotal: number; lastPeriodTo: string | null;
}

function Section({ n, icon: Icon, title, hint, children }: { n: number; icon: LucideIcon; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white shadow-card" aria-labelledby={`inv-sec-${n}`}>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary"><Icon size={18} aria-hidden /></span>
        <div className="min-w-0">
          <h3 id={`inv-sec-${n}`} className="text-sm font-extrabold tracking-tight text-dark"><span className="mr-1.5 text-primary">{n}</span>{title}</h3>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </header>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}
const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${on ? "border-primary bg-primary text-white shadow-brand-sm" : "border-line bg-white text-slate-600 hover:border-primary hover:text-primary"}`;
const subLabel = "mb-1.5 block text-xs font-bold text-slate-600";
const dateLabel = (iso: string) => { const t = new Date(`${iso}T00:00:00Z`); return !iso || Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };
const pctOf = (n: number, total: number) => (total > 0 ? Math.max(0, (n / total) * 100) : 0);
const monthRange = (today: string, back: number) => {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  const from = d.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
};
const ZERO: LineTotals = { subtotal: 0, vat: 0, gross: 0, count: 0, overCount: 0 };

/** Invoice submission of the login portal. Visual twin of ProgressUpdateForm: numbered section cards, subcontract tiles, sticky summary card (lg+), sticky bottom bar (phones). */
export default function SessionInvoiceForm({ assignments, defaultAssignment, today, vatRate, currency, defaults, cancelHref }: {
  assignments: InvoiceAsg[]; defaultAssignment?: number; today: string; vatRate: number; currency: string; defaults: { name: string; email: string }; cancelHref?: string;
}) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(submitInvoice, undefined);
  const [asg, setAsg] = useState(defaultAssignment && assignments.some((a) => a.id === defaultAssignment) ? defaultAssignment : assignments[0]?.id);
  const [ref, setRef] = useState("");
  const [invDate, setInvDate] = useState(today);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [name, setName] = useState(defaults.name);
  const [email, setEmail] = useState(defaults.email);
  const [editBy, setEditBy] = useState(false);
  const [totals, setTotals] = useState<LineTotals>(ZERO);
  const [att, setAtt] = useState<AttachState>({ tax: false, measurement: false, count: 0 });
  const [localErr, setLocalErr] = useState("");
  const onTotals = useCallback((t: LineTotals) => setTotals(t), []);

  const cur = assignments.find((a) => a.id === asg);
  const money = (n: number) => formatMoney(n, { currency, decimals: 2 });
  const badPeriod = !!from && !!to && to < from;
  useEffect(() => { (document.getElementById("period-to") as HTMLInputElement | null)?.setCustomValidity(badPeriod ? "Period to must be on or after period from" : ""); }, [badPeriod]);
  useEffect(() => { setTotals(ZERO); }, [asg]);

  const ded = deductions(totals.gross, cur?.retentionPct ?? 0, cur?.advancePct ?? 0);
  const cv = cur?.contractValue ?? 0;
  const certPct = pctOf(cur?.certifiedSubtotal ?? 0, cv);
  const billedPct = pctOf(cur?.billedSubtotal ?? 0, cv);
  const afterPct = pctOf((cur?.billedSubtotal ?? 0) + totals.subtotal, cv);
  const thisPct = pctOf(totals.subtotal, cv);
  const overContract = afterPct > 100.01;
  const period = from || to ? `${from ? dateLabel(from) : "…"} – ${to ? dateLabel(to) : "…"}` : "Not set";
  const useTiles = assignments.length <= 6;
  const checks = [
    { ok: ref.trim().length > 0, text: "Invoice number entered" }, { ok: totals.count > 0, text: "At least one line with quantity" },
    { ok: att.tax, text: "Tax invoice attached (required)" }, { ok: att.measurement, text: "Measurement sheet (recommended)" },
  ];
  const guard = (e: React.FormEvent<HTMLFormElement>) => {
    if (!att.tax) { e.preventDefault(); setLocalErr("Attach a copy of your signed tax invoice before submitting."); document.getElementById("inv-sec-4")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    setLocalErr(""); onSubmit(e);
  };
  const err = localErr || state?.error;
  const submitBtn = (cls: string) => (
    <button type="submit" disabled={pending} className={`inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-brand transition hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-60 ${cls}`}>{pending ? "Submitting…" : "Submit invoice"}</button>
  );
  const bar = (a: InvoiceAsg, h = "h-1.5") => (
    <span className={`relative block ${h} overflow-hidden rounded-full bg-slate-200`}>
      <span className="absolute inset-y-0 left-0 bg-primary/35" style={{ width: `${Math.min(100, pctOf(a.billedSubtotal, a.contractValue))}%` }} />
      <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(100, pctOf(a.certifiedSubtotal, a.contractValue))}%` }} />
    </span>
  );
  const tile = (a: InvoiceAsg, selected: boolean, locked: boolean) => (
    <span className={`flex h-full flex-col gap-2 rounded-xl border-[1.5px] p-3 transition ${selected ? "border-primary bg-primary-50/60 ring-4 ring-primary/10" : "border-line bg-white hover:border-primary/50"} ${locked ? "opacity-90" : "cursor-pointer"}`}>
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0"><span className="block truncate text-sm font-extrabold text-dark">{a.code}</span>
          <span className="block truncate text-xs text-slate-500">{a.projectCode}{a.stageName ? ` · ${a.stageName}` : ""}</span></span>
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary bg-primary text-white" : "border-slate-300"}`}>{selected && <Check size={12} strokeWidth={3} />}</span>
      </span>
      <span className="mt-auto block">
        {bar(a)}
        <span className="mt-1 block text-[11px] tabular-nums text-slate-500">Certified {Math.round(pctOf(a.certifiedSubtotal, a.contractValue))}% of {formatMoney(a.contractValue, { currency, compact: true })}</span>
      </span>
    </span>
  );

  return (
    <form onSubmit={guard} data-action-form="" data-testid="invoice-form" className="pb-28 md:pb-0">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0 space-y-5">
          <Section n={1} icon={MapPin} title="Subcontract" hint="Which subcontract are you invoicing?">
            {useTiles ? (
              <fieldset>
                <legend className={subLabel}>Subcontract</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {assignments.map((a) => (
                    <label key={a.id} className="block rounded-xl focus-within:ring-4 focus-within:ring-primary/25">
                      <input type="radio" name="assignment_id" value={a.id} checked={asg === a.id} onChange={() => setAsg(a.id)} className="sr-only" required />
                      {tile(a, asg === a.id, false)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <>
                <Field label="Subcontract"><Select name="assignment_id" value={asg} onChange={(e) => setAsg(Number(e.target.value))} options={assignments.map((a) => ({ value: a.id, label: a.label }))} required /></Field>
                {cur && <div className="sm:w-1/2">{tile(cur, true, true)}</div>}
              </>
            )}
            {cur && (
              <dl className="grid grid-cols-2 gap-2">
                {[["Contract value", money(cur.contractValue)], ["Retention", `${cur.retentionPct}%`], ["Advance recovery", `${cur.advancePct}%`], ["Payment terms", cur.paymentDays ? `${cur.paymentDays} days` : "—"]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k}</dt><dd className="whitespace-nowrap text-sm font-extrabold tabular-nums text-dark">{v}</dd></div>
                ))}
                <div className="col-span-2 rounded-xl bg-slate-50 px-3 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Already on this subcontract</dt>
                  <dd className="text-sm tabular-nums text-slate-600">Claimed {money(cur.billedSubtotal)} ({Math.round(billedPct)}%) · Certified {money(cur.certifiedSubtotal)} ({Math.round(certPct)}%) <span className="text-xs text-slate-400">excl. VAT</span></dd>
                </div>
              </dl>
            )}
          </Section>

          <Section n={2} icon={CalendarRange} title="Invoice details" hint="Your invoice number, date and the billing period it covers.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Your invoice number" hint="Exactly as printed on your tax invoice."><Input name="sub_invoice_ref" required placeholder="e.g. INV-2026-014" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
              <Field label="Invoice date"><Input type="date" name="invoice_date" value={invDate} onChange={(e) => setInvDate(e.target.value)} required /></Field>
              <Field label="Period from"><Input type="date" name="period_from" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} /></Field>
              <Field label="Period to"><Input id="period-to" type="date" name="period_to" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} aria-invalid={badPeriod} aria-describedby={badPeriod ? "period-err" : undefined} /></Field>
            </div>
            {badPeriod && <p id="period-err" role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-red-600"><AlertTriangle size={13} aria-hidden />Period to must be on or after period from.</p>}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Billing period shortcuts">
              {(() => {
                const tm = monthRange(today, 0), lm = monthRange(today, 1);
                const since = cur?.lastPeriodTo ? { from: addDays(cur.lastPeriodTo, 1), to: today } : null;
                const opts: [string, { from: string; to: string }][] = [["This month", tm], ["Last month", lm], ...(since ? [["Since last invoice", since] as [string, { from: string; to: string }]] : [])];
                return opts.map(([t, r]) => (
                  <button key={t} type="button" aria-pressed={from === r.from && to === r.to} onClick={() => { setFrom(r.from); setTo(r.to); }} className={chip(from === r.from && to === r.to)}><CalendarRange size={13} />{t}</button>
                ));
              })()}
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-600">Submitted by <b className="text-dark">{name || "—"}</b>{email ? <> · {email}</> : null}</span>
                <button type="button" aria-expanded={editBy} onClick={() => setEditBy(!editBy)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-primary hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><Pencil size={12} aria-hidden />{editBy ? "Done" : "Edit"}</button>
              </div>
              <div className={editBy ? "mt-3 grid gap-3 sm:grid-cols-2" : "hidden"}>
                <Field label="Submitted by"><Input name="submitted_by_name" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
                <Field label="Contact email"><Input type="email" name="submitted_by_email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              </div>
            </div>
          </Section>

          <Section n={3} icon={ListChecks} title="Line items" hint="Enter this period's quantities. Rates and contract quantities are fixed.">
            {cur && <PortalLinesEditor key={cur.id} boq={cur.boq} vatRate={vatRate} currency={currency} onTotals={onTotals} />}
          </Section>

          <Section n={4} icon={Paperclip} title="Supporting documents" hint="A signed copy of your tax invoice is required; a measurement sheet helps the review.">
            <PortalAttachments onChange={setAtt} />
          </Section>

          <Section n={5} icon={StickyNote} title="Notes" hint="Anything the project team should know about this claim (optional).">
            <Textarea name="notes" rows={3} aria-label="Notes" placeholder="e.g. Includes variation work approved on site on 12 Nov." />
          </Section>
        </div>

        <aside className="xl:sticky xl:top-20" aria-label="Invoice summary">
          <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            <div className="bg-gradient-to-br from-primary to-primary-dark px-5 py-3 text-white">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">Invoice summary</div>
              <div className="mt-0.5 truncate text-base font-extrabold">{cur?.code ?? "No subcontract"}</div>
              <div className="truncate text-xs text-white/80">{cur?.projectCode}{cur?.projectName ? ` · ${cur.projectName}` : ""}</div>
            </div>
            <dl className="space-y-1.5 px-5 py-3 text-sm">
              {[["Invoice no.", ref.trim() || "—"], ["Period", period], ["Lines claimed", String(totals.count)], ["Subtotal", money(totals.subtotal)], [`VAT ${vatRate}%`, money(totals.vat)]].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3"><dt className="min-w-0 text-slate-500">{k}</dt><dd className="whitespace-nowrap text-right font-bold tabular-nums text-dark">{v}</dd></div>
              ))}
            </dl>
            <div className="border-t border-line px-5 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Gross claimed</div>
              <div className="text-2xl font-extrabold tabular-nums text-dark" data-testid="summary-gross">{money(totals.gross)}</div>
              {totals.gross > 0 && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{amountInWords(totals.gross, currency)}</p>}
            </div>
            <div className="border-t border-line bg-slate-50/70 px-5 py-3 text-sm">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"><Calculator size={12} aria-hidden />Estimate — final amount after certification</div>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3"><dt className="min-w-0 text-slate-500">Less retention {cur?.retentionPct ?? 0}%</dt><dd className="whitespace-nowrap tabular-nums">− {money(ded.retention)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="min-w-0 text-slate-500">Less advance recovery {cur?.advancePct ?? 0}%</dt><dd className="whitespace-nowrap tabular-nums">− {money(ded.advance)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-line pt-1.5"><dt className="font-bold text-slate-700">Estimated net payable</dt><dd className="whitespace-nowrap font-extrabold tabular-nums text-dark" data-testid="summary-net">{money(ded.net)}</dd></div>
              </dl>
            </div>
            {cv > 0 && (
              <div className="border-t border-line px-5 py-3">
                <div className="mb-1.5 flex items-baseline justify-between text-sm"><span className="text-slate-500">Contract progress after this claim</span><b className={`tabular-nums ${overContract ? "text-red-600" : "text-dark"}`}>{afterPct.toFixed(1)}%</b></div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`${afterPct.toFixed(1)} percent of the contract value after this claim`}>
                  <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(100, billedPct)}%` }} />
                  <div className={`absolute inset-y-0 ${overContract ? "bg-red-500" : "bg-[repeating-linear-gradient(45deg,#a5a0ff_0_5px,#c7c4ff_5px_10px)]"}`} style={{ left: `${Math.min(100, billedPct)}%`, width: `${Math.max(0, Math.min(100 - Math.min(100, billedPct), thisPct))}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Claimed so far {billedPct.toFixed(1)}% · this claim +{thisPct.toFixed(1)}% (excl. VAT)</p>
                {(overContract || totals.overCount > 0) && <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-red-700"><AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />{totals.overCount > 0 ? `${totals.overCount} line${totals.overCount === 1 ? "" : "s"} exceed the contract quantity.` : "This claim exceeds the contract value."}</p>}
              </div>
            )}
            <ul className="space-y-1.5 border-t border-line px-5 py-3 text-sm">
              {checks.map((c) => (
                <li key={c.text} className={`flex items-center gap-2 ${c.ok ? "text-dark" : "text-slate-400"}`}>
                  {c.ok ? <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-success text-white"><Check size={11} strokeWidth={3} /></span> : <Circle size={18} className="text-slate-300" />}{c.text}
                </li>
              ))}
            </ul>
            <div className="hidden space-y-2 border-t border-line px-5 py-3 md:block">
              {err && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</p>}
              {submitBtn("w-full")}
              {cancelHref && <Link href={cancelHref} className="block text-center text-xs font-bold text-slate-500 hover:text-primary">Cancel</Link>}
            </div>
          </div>
          <p className="mt-2 hidden px-1 text-[11px] text-slate-400 md:block"><FileText size={11} className="mr-1 inline" />Invoices are certified by the project team; the amount payable may differ.</p>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-[52px] z-[1100] border-t border-line bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        {err && <p role="alert" className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{err}</p>}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs"><div className="truncate font-extrabold tabular-nums text-dark">{money(totals.gross)}</div><div className="truncate text-slate-500">{totals.count} line{totals.count === 1 ? "" : "s"} · gross incl. VAT</div></div>
          {cancelHref && <Link href={cancelHref} className="text-xs font-bold text-slate-500">Cancel</Link>}
          {submitBtn("shrink-0")}
        </div>
      </div>
    </form>
  );
}

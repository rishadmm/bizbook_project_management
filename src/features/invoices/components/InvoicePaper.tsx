import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { fromGross } from "../calc";
import type { InvoiceDetail } from "../queries";
import { amountInWords } from "../words";

const th = "border-b border-slate-300 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500";
const td = "px-2 py-1.5 align-top";
const n3 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</div><div className="text-[13px] leading-5 text-slate-700">{children}</div></div>;
}

/** The invoice as a paper document: subcontractor letterhead, tax invoice, lines, certification, payment and signatures. Pure server rendering. */
export function InvoicePaper({ d }: { d: InvoiceDetail }) {
  const { invoice: i, subcontractor: s, company, project, assignment: a, lines } = d;
  const cur = i.currency || "AED";
  const m = (v: number) => formatMoney(v, { decimals: 2, currency: cur });
  const money = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const certGross = d.certifiedState ? i.certified_amount : 0;
  const cert = fromGross(certGross, i.vat_rate);
  const paper = "print-paper mx-auto w-full max-w-[860px] rounded-2xl border border-line bg-white p-6 shadow-card sm:p-10";
  return (
    <article className={paper} data-testid="invoice-paper">
      {/* letterhead */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-primary pb-4">
        <div>
          <div className="text-xl font-extrabold tracking-tight text-dark">{s.name}</div>
          <div className="mt-1 text-[12px] leading-5 text-slate-500">
            {s.address && <div>{s.address}</div>}
            <div>{s.tax_no ? `TRN ${s.tax_no}` : "TRN not on file"}{s.trade_license_no ? ` · Trade licence ${s.trade_license_no}` : ""}</div>
            <div>{[s.contact_person, s.phone, s.email].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold tracking-tight text-primary">TAX INVOICE</div>
          <div className="mt-1 text-[12px] text-slate-500">Payment certificate · {statusLabel("invoiceStatus", i.status)}</div>
        </div>
      </header>

      {/* meta + bill to */}
      <section className="mt-5 grid gap-5 sm:grid-cols-2">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-slate-400">Invoice no.</dt><dd className="font-semibold text-dark">{i.invoice_no ?? `#${i.id}`}</dd>
          <dt className="text-slate-400">Supplier ref.</dt><dd className="font-semibold">{i.sub_invoice_ref ?? "—"}</dd>
          <dt className="text-slate-400">Invoice date</dt><dd>{formatDate(i.invoice_date)}</dd>
          <dt className="text-slate-400">Due date</dt><dd>{formatDate(i.due_date)}</dd>
          <dt className="text-slate-400">Period</dt><dd>{i.period_from ? `${formatDate(i.period_from)} – ${formatDate(i.period_to)}` : "—"}</dd>
          <dt className="text-slate-400">Currency</dt><dd>{cur}</dd>
        </dl>
        <Block title="Bill to">
          <div className="font-bold text-dark">{company.name}</div>
          {company.address && <div>{company.address}</div>}
          {company.trn && <div>TRN {company.trn}</div>}
        </Block>
      </section>

      <section className="mt-4 grid gap-3 rounded-xl bg-[#f8fafc] p-3 text-[13px] sm:grid-cols-2">
        <div><span className="text-slate-400">Project </span><b className="text-dark">{project.code}</b> · {project.name}</div>
        <div><span className="text-slate-400">Subcontract </span><b className="text-dark">{a.code ?? "—"}</b> · contract value {m(a.contract_value)}</div>
        <div><span className="text-slate-400">Stage </span>{d.stages.length ? d.stages.map((x) => `${x.code ?? ""} ${x.name}`.trim()).join(", ") : "—"}</div>
        <div><span className="text-slate-400">PO / subcontract no. </span>{a.code ?? "—"}{a.scope ? ` · ${a.scope}` : ""}</div>
      </section>

      {/* lines */}
      <section className="mt-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]" data-testid="invoice-lines">
            <thead><tr className="text-left"><th className={th}>#</th><th className={th}>Item / description</th><th className={th}>Unit</th><th className={`${th} text-right`}>Contract qty</th><th className={`${th} text-right`}>Previous</th><th className={`${th} text-right`}>This period</th><th className={`${th} text-right`}>Cumulative</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.id} data-line-no={l.line_no}>
                  <td className={`${td} text-slate-400`}>{l.line_no}</td>
                  <td className={td}><div className="font-semibold text-slate-800">{l.description}</div>{l.item_code && <div className="text-[11px] text-slate-400">{l.item_code}</div>}</td>
                  <td className={td}>{l.unit ?? ""}</td>
                  <td className={`${td} text-right tabular-nums`}>{n3(l.contract_qty)}</td>
                  <td className={`${td} text-right tabular-nums text-slate-500`}>{n3(l.prev_qty)}</td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{n3(l.this_qty)}</td>
                  <td className={`${td} text-right tabular-nums`}>{n3(l.cum_qty)}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(l.rate)}</td>
                  <td className={`${td} text-right tabular-nums font-semibold`}>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ml-auto mt-3 w-full max-w-[320px] space-y-1 text-[13px]">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums" data-testid="inv-subtotal">{m(i.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">VAT {i.vat_rate}%</span><span className="tabular-nums">{m(i.vat_amount)}</span></div>
          <div className="flex justify-between border-t border-slate-300 pt-1 text-[14px] font-extrabold text-dark"><span>Total claimed (gross)</span><span className="tabular-nums" data-testid="inv-gross">{m(i.claimed_amount)}</span></div>
        </div>
      </section>

      {/* certification */}
      <section className="mt-7 rounded-xl border border-primary-100 p-4" data-testid="certification">
        <h3 className="text-sm font-extrabold tracking-tight text-dark">Certification</h3>
        {!d.certifiedState ? (
          <p className="mt-2 text-[13px] text-slate-500">{i.status === "rejected" ? "This invoice was rejected and is not certified." : "Awaiting certification by the project team."}</p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead><tr className="text-left"><th className={th}>#</th><th className={th}>Item</th><th className={`${th} text-right`}>Claimed qty</th><th className={`${th} text-right`}>Certified qty</th><th className={`${th} text-right`}>Claimed amount</th><th className={`${th} text-right`}>Certified amount</th><th className={th}>Remarks</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l) => {
                    const cut = l.certified_amount < l.amount - 0.005;
                    return (
                      <tr key={l.id} className={cut ? "bg-amber-50" : ""} data-cut={cut ? "1" : undefined}>
                        <td className={`${td} text-slate-400`}>{l.line_no}</td>
                        <td className={td}>{l.item_code ?? l.description}</td>
                        <td className={`${td} text-right tabular-nums`}>{n3(l.this_qty)}</td>
                        <td className={`${td} text-right tabular-nums ${cut ? "font-bold text-amber-700" : ""}`}>{n3(l.certified_qty)}</td>
                        <td className={`${td} text-right tabular-nums`}>{money(l.amount)}</td>
                        <td className={`${td} text-right tabular-nums ${cut ? "font-bold text-amber-700" : ""}`}>{money(l.certified_amount)}</td>
                        <td className={`${td} text-slate-600`}>{l.remarks ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ml-auto mt-3 w-full max-w-[360px] space-y-1 text-[13px]">
              <div className="flex justify-between"><span className="text-slate-500">Certified subtotal</span><span className="tabular-nums">{m(cert.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">VAT {i.vat_rate}%</span><span className="tabular-nums">{m(cert.vat)}</span></div>
              <div className="flex justify-between font-bold text-dark"><span>Certified (gross)</span><span className="tabular-nums" data-testid="inv-certified">{m(certGross)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Less retention ({i.retention_percent || a.retention_pct}%)</span><span className="tabular-nums">− {m(i.retention_amount)}</span></div>
              <div className="flex justify-between text-slate-600"><span>Less advance recovery ({i.advance_recovery_percent || a.advance_pct}%)</span><span className="tabular-nums">− {m(i.advance_recovery)}</span></div>
              <div className="flex justify-between rounded-lg bg-primary-50 px-2 py-1.5 text-[15px] font-extrabold text-primary-dark"><span>Net payable</span><span className="tabular-nums" data-testid="inv-net">{m(i.net_payable)}</span></div>
            </div>
            <p className="mt-3 text-[12px] italic text-slate-600">{amountInWords(i.net_payable, cur)}</p>
          </>
        )}
      </section>

      {/* payment */}
      <section className="mt-5 rounded-xl bg-[#f8fafc] p-4 text-[13px]">
        <h3 className="mb-2 text-sm font-extrabold tracking-tight text-dark">Payment</h3>
        {i.status === "paid" ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div><dt className="text-[11px] text-slate-400">Paid amount</dt><dd className="font-bold text-green-700">{m(i.paid_amount)}</dd></div>
            <div><dt className="text-[11px] text-slate-400">Paid on</dt><dd>{formatDate(i.paid_date)}</dd></div>
            <div><dt className="text-[11px] text-slate-400">Method</dt><dd>{i.payment_method ?? "—"}</dd></div>
            <div><dt className="text-[11px] text-slate-400">Reference</dt><dd>{i.payment_ref ?? "—"}</dd></div>
          </dl>
        ) : <p className="text-slate-500">Not paid yet{i.due_date ? ` · due ${formatDate(i.due_date)}` : ""}{a.payment_terms ? ` · ${a.payment_terms}` : ""}</p>}
        {s.bank_name && <p className="mt-2 text-[12px] text-slate-500">Pay to: {s.bank_name}{s.iban_masked ? ` · IBAN ${s.iban_masked}` : ""}</p>}
      </section>

      {/* signatures */}
      <section className="mt-6 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4" data-testid="signatures">
        {([["Submitted by", d.people.submittedBy, d.people.submittedAt], ["Reviewed by", d.people.reviewedBy, null], ["Certified by", d.people.certifiedBy, d.people.certifiedAt], ["Approved by", d.people.approvedBy, d.people.approvedAt]] as const).map(([label, who, when]) => (
          <div key={label} className="rounded-lg border border-slate-200 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-5 min-h-5 border-b border-slate-300 pb-0.5 font-semibold text-dark">{who ?? ""}</div>
            <div className="mt-1 text-slate-400">{when ? formatDateTime(when) : "—"}</div>
          </div>
        ))}
      </section>
      {d.invoice.notes && <p className="mt-4 whitespace-pre-line text-[12px] text-slate-500"><b>Notes:</b> {d.invoice.notes}</p>}
    </article>
  );
}

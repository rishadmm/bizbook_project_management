import Link from "next/link";
import { FileDown } from "lucide-react";
import { CardSection, EmptyState, PageHeader, Select, Table, TBody, TD, TH, THead, TR, Button } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import { formatDate, formatMoney } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { getPayments, getStatement, listAssignments } from "@/features/portal/data";

export const metadata = { title: "Payments & statement" };

export default async function PortalPayments({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ assignment?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const s = await requirePortalUser(slug, "payments");
  const asgs = listAssignments(s);
  const only = asgs.find((a) => String(a.id) === sp.assignment)?.id;
  const stmt = getStatement(s, only);
  const pays = getPayments(s, only);
  const tot = stmt.reduce((t, r) => ({ cv: t.cv + r.contractValue, cl: t.cl + r.claimed, ce: t.ce + r.certified, re: t.re + r.retention, ad: t.ad + r.advance, ne: t.ne + r.netPayable, pa: t.pa + r.paid, ou: t.ou + r.outstanding }), { cv: 0, cl: 0, ce: 0, re: 0, ad: 0, ne: 0, pa: 0, ou: 0 });
  return (
    <>
      <PageHeader title="Payments & statement" description="Statement of account per subcontract and your payment history."
        actions={<a href={`/p/${slug}/payments/export${only ? `?assignment=${only}` : ""}`} className={buttonClass("secondary")} data-testid="export-csv"><FileDown size={15} />Export CSV</a>} />
      <form className="mb-4 flex gap-2"><div className="w-72"><Select name="assignment" defaultValue={only ? String(only) : ""} placeholder="All subcontracts" options={asgs.map((a) => ({ value: a.id, label: `${a.code ?? `#${a.id}`} · ${a.project_code}` }))} /></div><Button type="submit">Filter</Button></form>
      <CardSection title="Statement of account" subtitle="Claimed (gross, incl. VAT) → certified → less retention and advance recovery → net payable" flush className="mb-5">
        {stmt.length === 0 ? <div className="p-4"><EmptyState title="No subcontracts" /></div> : (
          <Table>
            <THead><TR><TH>Subcontract</TH><TH num>Contract value</TH><TH num>Claimed</TH><TH num>Certified</TH><TH num>Retention held</TH><TH num>Advance recovered</TH><TH num>Net payable</TH><TH num>Paid</TH><TH num>Outstanding</TH></TR></THead>
            <TBody>
              {stmt.map((r) => (
                <TR key={r.assignmentId} data-testid="statement-row"><TD><Link className="font-bold text-primary-dark hover:underline" href={`/p/${slug}/projects/${r.assignmentId}`}>{r.code}</Link><div className="text-xs text-slate-400">{r.project}</div></TD>
                  <TD num>{formatMoney(r.contractValue)}</TD><TD num>{formatMoney(r.claimed)}</TD><TD num>{formatMoney(r.certified)}</TD><TD num>{formatMoney(r.retention)}</TD><TD num>{formatMoney(r.advance)}</TD><TD num>{formatMoney(r.netPayable)}</TD>
                  <TD num className="font-semibold text-green-700">{formatMoney(r.paid)}</TD><TD num className="font-semibold">{formatMoney(r.outstanding)}</TD></TR>
              ))}
              <TR className="bg-[#f8fafc] font-extrabold"><TD>Total</TD><TD num>{formatMoney(tot.cv)}</TD><TD num>{formatMoney(tot.cl)}</TD><TD num>{formatMoney(tot.ce)}</TD><TD num>{formatMoney(tot.re)}</TD><TD num>{formatMoney(tot.ad)}</TD><TD num>{formatMoney(tot.ne)}</TD><TD num>{formatMoney(tot.pa)}</TD><TD num>{formatMoney(tot.ou)}</TD></TR>
            </TBody>
          </Table>
        )}
      </CardSection>
      <CardSection title="Payment history" flush>
        {pays.length === 0 ? <div className="p-4"><EmptyState title="No payments yet" /></div> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Invoice</TH><TH>Subcontract</TH><TH num>Amount</TH><TH>Method</TH><TH>Reference</TH></TR></THead>
            <TBody>{pays.map((p) => <TR key={p.invoiceId}><TD className="whitespace-nowrap">{formatDate(p.date)}</TD><TD><Link className="font-bold text-primary-dark hover:underline" href={`/p/${slug}/invoices/${p.invoiceId}`}>{p.invoiceNo}</Link></TD><TD>{p.assignmentCode}</TD><TD num>{formatMoney(p.amount)}</TD><TD>{p.method ?? "—"}</TD><TD>{p.paymentRef ?? "—"}</TD></TR>)}</TBody>
          </Table>
        )}
      </CardSection>
    </>
  );
}

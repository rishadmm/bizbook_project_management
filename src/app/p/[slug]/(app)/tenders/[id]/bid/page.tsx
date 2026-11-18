import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, X } from "lucide-react";
import { Badge, CardSection, PageHeader } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { getDb } from "@/lib/db";
import { requirePortalUser } from "@/lib/portal-auth";
import { portalCan } from "@/lib/portal-core";
import { countdown, decimalsOf, formatLocal } from "@/lib/rfx";
import { formatMoney } from "@/lib/format";
import { myBidContent, portalTender } from "@/features/procurement/portal-queries";
import { boqOf, requirementsOf } from "@/features/procurement/rfx-core";
import { isBiddingOpen, submitBlockers } from "@/features/procurement/bid-core";
import { CommercialForm, SubmitPanel, TechnicalForm } from "@/features/procurement/components/PortalForms";

export const metadata = { title: "Bid workspace" };

export default async function BidWorkspace({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { slug, id } = await params;
  const s = await requirePortalUser(slug, "tenders");
  const t = portalTender(Number(id), s.sub.id, s.entity.id);
  if (!t || !t.eligible && !t.bid) notFound();
  if (!portalCan(s.user.role, "tenders_bid")) redirect(`/p/${slug}/tenders/${id}`);
  const { rfx } = t;
  const db = getDb();
  const step = Math.min(3, Math.max(1, Number((await searchParams).step) || 1));
  const open = isBiddingOpen(rfx);
  const bid = t.bid;
  const locked = !open || s.readOnly;
  const reqs = requirementsOf(db, rfx.id);
  const content = bid ? myBidContent(bid.id) : { responses: [], prices: [], history: [] };
  const resp = new Map(content.responses.map((r) => [r.requirement_id, r]));
  const dec = decimalsOf(s.entity.currency);
  const price = new Map(content.prices.filter((p) => p.version === 1).map((p) => [p.boq_line_id, p.unit_rate]));
  const blockers = bid ? submitBlockers(db, rfx, bid) : ["Save the technical and commercial envelopes first."];
  const rq = (kind: "technical" | "commercial") => reqs.filter((q) => q.envelope === kind).map((q) => ({ id: q.id, name: q.name, kind: q.kind, mandatory: q.mandatory, instructions: q.instructions, value_text: resp.get(q.id)?.value_text ?? null, value_number: resp.get(q.id)?.value_number ?? null, filename: resp.get(q.id)?.filename ?? null }));
  const base = `/p/${slug}/tenders/${rfx.id}`;
  const steps = ["Technical envelope", "Commercial envelope", "Review & submit"];
  return (
    <>
      <PageHeader title={`Bid · ${rfx.code}`} description={rfx.title} breadcrumbs={[{ label: "Tenders", href: `/p/${slug}/tenders` }, { label: rfx.code, href: base }, { label: "Bid" }]}
        badges={bid?.status === "submitted" ? <Badge tone="green">Submitted (revision {bid.revision})</Badge> : bid?.status === "draft" ? <Badge tone="slate">Draft</Badge> : undefined} />
      <div className="mb-4 rounded-xl border border-line bg-white px-4 py-3 text-sm" data-testid="deadline">Closing <b>{formatLocal(rfx.closing_at)}</b> <span className="font-semibold text-primary">{open ? countdown(rfx.closing_at) : "- bidding is closed, the bid is read-only"}</span></div>
      {!open && !bid && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" data-testid="late-message">Bidding is closed. Late bids are not accepted.</p>}
      <ol className="mb-5 flex flex-wrap gap-2">{steps.map((l, i) => (
        <li key={l}><Link href={`${base}/bid?step=${i + 1}`} className={cn("flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold ring-1", step === i + 1 ? "bg-primary text-white ring-primary" : "bg-white text-slate-600 ring-line hover:bg-primary-50")}><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-xs">{i + 1}</span>{l}</Link></li>))}</ol>
      {step === 1 && <CardSection title="1. Technical envelope" subtitle="Upload or answer every requirement. Mandatory items are marked."><TechnicalForm rfxId={rfx.id} reqs={rq("technical")} locked={locked} /></CardSection>}
      {step === 2 && (
        <CardSection title="2. Commercial envelope" subtitle={`Price every BOQ line in ${s.entity.currency} (${dec} decimals). VAT is added at ${s.entity.vat_rate}%.`}>
          <CommercialForm rfxId={rfx.id} currency={s.entity.currency} vatRate={s.entity.vat_rate} dec={dec} locked={locked} discount={bid?.discount_amount ?? 0} deviations={bid?.deviations ?? ""} alternative={bid?.alternative_offer ?? ""} validity={bid?.validity_days ?? null} minValidity={rfx.validity_days} bondRef={bid?.bid_bond_ref ?? ""}
            lines={boqOf(db, rfx.id).map((l) => ({ id: l.id, item_no: l.item_no, description: l.description, unit: l.unit, quantity: l.quantity, rate: price.get(l.id) ?? null }))} commercialReqs={rq("commercial")} />
        </CardSection>)}
      {step === 3 && (
        <CardSection title="3. Review and submit" subtitle="Everything below must be complete before you can submit.">
          <ul className="mb-4 space-y-1.5 text-sm" data-testid="checklist">
            {blockers.length === 0 ? <li className="flex items-center gap-2 text-emerald-700"><Check size={16} />Every mandatory item is present, addenda are acknowledged, your registration documents are valid and bidding is open.</li>
              : blockers.map((b) => <li key={b} className="flex items-start gap-2 text-red-700"><X size={16} className="mt-0.5 shrink-0" />{b}</li>)}
          </ul>
          {bid && bid.total_amount !== null && <p className="mb-4 text-sm">Your net total: <b>{formatMoney(bid.total_amount, { currency: s.entity.currency, decimals: dec })}</b> excl. VAT (VAT {formatMoney(bid.vat_amount, { currency: s.entity.currency, decimals: dec })}).</p>}
          {bid?.status === "submitted" && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm" data-testid="receipt"><div className="font-extrabold text-emerald-800">Bid received</div>
              <div>Submitted at {formatLocal(bid.submitted_at)} (revision {bid.revision})</div><div className="break-all font-mono text-xs">Receipt hash (SHA-256): {bid.receipt_hash}</div>
              {content.history.length > 0 && <div className="mt-1 text-xs text-slate-500">Earlier revisions: {content.history.map((h) => `#${h.revision} ${formatLocal(h.submitted_at)}`).join("; ")}</div>}</div>)}
          {!locked && bid?.status !== "withdrawn" ? <SubmitPanel rfxId={rfx.id} ready={blockers.length === 0} submitted={bid?.status === "submitted"} revision={bid?.revision ?? 0} /> : <p className="text-sm text-slate-500">{locked ? "The bid is read-only." : ""}</p>}
        </CardSection>)}
    </>
  );
}

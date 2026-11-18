/* eslint-disable @typescript-eslint/no-explicit-any */
// Demo data for the subcontractor invoice documents (INVOICE_SPEC section 6): lines, VAT, certification (with per-line cuts), people, ERP state, and
// real attachment files (subcontractor tax invoice PDF, measurement sheet PDF, site photos as SVG, timesheets, delivery notes) written to the uploads dir.
// Called from seed.ts (sync part before the approval demo, async file generation at the end). Uses only relative imports (runs under tsx, CJS).
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { nanoid } from "nanoid";
import type { DB } from "./db";
import { addDays } from "./format";
import { deductions, fromSubtotal, r2, r3 } from "../features/invoices/calc";
import { getRegionProfile } from "./seed-regions";
import { currencyDecimals } from "./format";

type Item = [desc: string, unit: string, price: number, share: number];
// region of the current seeding pass (the module is shared by every region: refreshed at the start of each exported function)
let PROFILE = getRegionProfile();
let CATALOG: Record<string, Item[]> = PROFILE.invoices.catalog;
let VAT = PROFILE.tenant.vatRate, CUR = PROFILE.tenant.currency, TAXL = PROFILE.tenant.taxLabel;
function loadRegion() { PROFILE = getRegionProfile(); CATALOG = PROFILE.invoices.catalog; VAT = PROFILE.tenant.vatRate; CUR = PROFILE.tenant.currency; TAXL = PROFILE.tenant.taxLabel; }
const SECTIONS = ["CH 0+000 – 0+500", "CH 0+500 – 1+100", "CH 1+100 – 1+800", "CH 1+800 – 2+400", "CH 2+400 – 3+000", "CH 3+000 – 3+600", "CH 3+600 – 4+200"];
const CUT_REMARKS = ["Reduced to the measured quantity (joint survey).", "Quantity above the signed measurement sheet; balance carried to next invoice.", "Reinstatement not accepted by the authority; pay on re-inspection.", "Depth below specification at part of the section; 20% held.", "Duplicate of the quantity certified in the previous invoice."];

const frac = (a: number, b: number) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };

interface InvRow { id: number; assignment_id: number; claimed_amount: number; certified_amount: number; status: string; source: string; invoice_date: string; created_at: string; period_from: string | null; period_to: string | null }
interface AsgRow { id: number; code: string; project_id: number; cv: number; scope: string | null; qty: number | null; stage_id: number | null; ret: number; adv: number; days: number; category: string; pm: number | null; sub_name: string; contact: string | null; email: string | null; sub_id: number }
type BoqLine = { code: string; desc: string; unit: string; rate: number; share: number; contractQty: number };

function buildBoq(a: AsgRow, long: boolean): BoqLine[] {
  const lump = !a.qty;
  if (long) {
    const base = CATALOG[a.category] ?? CATALOG.other;
    const out: BoqLine[] = [];
    SECTIONS.forEach((sec, si) => base.slice(0, 4).forEach(([desc, unit, price, share], ii) => {
      const rate = r2(price * (0.94 + 0.12 * frac(a.id, si * 4 + ii)));
      out.push({ code: `BOQ-${String(out.length + 1).padStart(2, "0")}`, desc: `${desc} — ${sec}`, unit, rate, share: share / SECTIONS.length, contractQty: 0 });
    }));
    return fin(out, a);
  }
  if (lump) return fin([{ code: "BOQ-01", desc: a.scope ?? "Lump sum services", unit: "lot", rate: 0, share: 1, contractQty: 0 }], a, true);
  const base = CATALOG[a.category] ?? CATALOG.other;
  const n = [1, 3, 4, 5, 2, 6, 3, 4][a.id % 8];
  const out = base.slice(0, n).map(([desc, unit, price, share], ii) => ({ code: `BOQ-${String(ii + 1).padStart(2, "0")}`, desc, unit, rate: r2(price * (0.93 + 0.14 * frac(a.id, ii))), share, contractQty: 0 }));
  return fin(out, a);
}
function fin(items: BoqLine[], a: AsgRow, lump = false): BoqLine[] {
  const tot = items.reduce((s, i) => s + i.share, 0);
  for (const it of items) {
    it.share /= tot;
    if (lump) { it.rate = r2(a.cv); it.contractQty = 1; } else it.contractQty = Math.ceil((a.cv * it.share) / it.rate * 100) / 100;
  }
  return items;
}

/** Sync part: fills sub_invoice_lines and the invoice document fields for every seeded invoice. Returns the ids of the long and of a showcase invoice on project 2. */
export function seedInvoiceDetails(db: DB, o: { today: string; entityId: number; users: { clerk: number; finance: number; finance2: number }; syncCost: (invoiceId: number) => void }): { longId: number | null; showcaseId: number | null } {
  loadRegion();
  const baseProject = (db.prepare("SELECT MIN(id) m FROM projects WHERE entity_id = ?").get(o.entityId) as { m: number }).m; // the region's 2nd project (P2, cable) carries the showcase invoices
  const asgs = db.prepare(`SELECT a.id, a.code, a.project_id, a.contract_value cv, a.scope, a.quantity qty, a.stage_id, a.retention_pct ret, a.advance_pct adv, a.payment_days days, p.category,
      p.manager_id pm, s.name sub_name, s.contact_person contact, s.email, s.id sub_id FROM assignments a JOIN projects p ON p.id = a.project_id JOIN subcontractors s ON s.id = a.subcontractor_id
      WHERE p.entity_id = ? AND EXISTS (SELECT 1 FROM sub_invoices i WHERE i.assignment_id = a.id) ORDER BY a.id`).all(o.entityId) as AsgRow[];
  const counts = new Map<number, number>();
  for (const a of asgs) counts.set(a.id, (db.prepare("SELECT COUNT(*) c FROM sub_invoices WHERE assignment_id = ?").get(a.id) as { c: number }).c);
  const p2 = asgs.filter((a) => a.project_id === baseProject + 1 && a.qty && a.category === "cable").sort((x, y) => (counts.get(y.id)! - counts.get(x.id)!) || x.id - y.id)[0];
  const insLine = db.prepare(`INSERT INTO sub_invoice_lines(invoice_id, line_no, item_code, description, unit, contract_qty, rate, prev_qty, this_qty, cum_qty, amount, certified_qty, certified_amount, remarks, stage_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const upd = db.prepare(`UPDATE sub_invoices SET claimed_amount=?, gross_amount=?, subtotal=?, vat_amount=?, currency=?, vat_rate=?, retention_percent=?, advance_recovery_percent=?, previous_certified=?,
    certified_amount=?, retention_amount=?, advance_recovery=?, net_payable=?, paid_amount=?, sub_invoice_ref=?, submitted_by_name=?, submitted_by_email=?, submitted_at=?, due_date=?,
    reviewed_by=?, certified_by=?, certified_at=?, payment_ref=?, payment_method=? WHERE id=?`);
  const userName = (id: number) => (db.prepare("SELECT name n, email e FROM users WHERE id = ?").get(id) as { n: string; e: string });
  let longId: number | null = null, showcase: { id: number; score: number } | null = null, syncedLeft = 3, failedLeft = 1;
  db.transaction(() => {
    for (const a of asgs) {
      const long = a === p2;
      const boq = buildBoq(a, long);
      const invs = db.prepare("SELECT id, assignment_id, claimed_amount, certified_amount, status, source, invoice_date, created_at, period_from, period_to FROM sub_invoices WHERE assignment_id = ? ORDER BY invoice_date, id").all(a.id) as InvRow[];
      const cum = new Map<string, number>();
      let prevCert = 0;
      const initials = a.sub_name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 3).map((w) => w[0].toUpperCase()).join("");
      invs.forEach((inv, k) => {
        const K = invs.length;
        const target = r2(inv.claimed_amount / (1 + VAT / 100));
        const active = long ? boq : boq.filter((_, i) => i < Math.ceil(boq.length * (0.5 + 0.5 * (K > 1 ? k / (K - 1) : 1))));
        const wsum = active.reduce((s, b) => s + b.share * (0.8 + 0.4 * frac(inv.id, b.share * 1000)), 0);
        const lines = active.map((b) => {
          const w = b.share * (0.8 + 0.4 * frac(inv.id, b.share * 1000)) / wsum;
          const q = Math.max(0.001, Math.ceil(((target * w) / b.rate) * 1000) / 1000);
          return { b, q, amount: r2(q * b.rate) };
        });
        const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
        const money = fromSubtotal(subtotal, VAT);
        const certState = ["certified", "approved", "paid"].includes(inv.status);
        // certification: spread the cut over the largest lines with remarks
        const f = inv.claimed_amount > 0 && certState ? Math.min(1, inv.certified_amount / inv.claimed_amount) : 0;
        const certSubTarget = certState ? r2(subtotal * f) : 0;
        let cut = certState ? r2(subtotal - certSubTarget) : 0;
        const certLines = lines.map((l) => ({ qty: certState ? l.q : 0, amount: certState ? l.amount : 0, remark: null as string | null }));
        if (cut > 0.5) {
          const order = lines.map((l, i) => i).sort((x, y) => lines[y].amount - lines[x].amount);
          for (const [n, i] of order.entries()) {
            if (cut <= 0) break;
            const take = n === 0 ? Math.min(cut, lines[i].amount * 0.7) : Math.min(cut, lines[i].amount * 0.5);
            const certQty = r3(Math.max(0, (lines[i].amount - take) / lines[i].b.rate));
            certLines[i] = { qty: certQty, amount: r2(certQty * lines[i].b.rate), remark: CUT_REMARKS[(inv.id + i) % CUT_REMARKS.length] };
            cut = r2(cut - (lines[i].amount - certLines[i].amount));
          }
        }
        const certSub = r2(certLines.reduce((s, l) => s + l.amount, 0));
        const certGross = certState ? (cut > 0.5 || f < 0.9999 ? fromSubtotal(certSub, VAT).gross : money.gross) : 0;
        const ded = certState ? deductions(certGross, a.ret, a.adv) : { retention: 0, advance: 0, net: 0 };
        lines.forEach((l, i) => {
          const prev = cum.get(l.b.code) ?? 0;
          insLine.run(inv.id, i + 1, l.b.code, l.b.desc, l.b.unit, l.b.contractQty, l.b.rate, r3(prev), l.q, r3(prev + l.q), l.amount, certLines[i].qty, certLines[i].amount, certLines[i].remark, a.stage_id);
          if (inv.status !== "rejected") cum.set(l.b.code, prev + l.q);
        });
        for (const b of boq) b.contractQty = Math.max(b.contractQty, Math.ceil((cum.get(b.code) ?? 0) * 100) / 100);
        const paid = inv.status === "paid";
        const portal = inv.source === "portal";
        const sub = portal ? { n: a.contact ?? a.sub_name, e: a.email } : { n: userName(o.users.clerk).n, e: userName(o.users.clerk).e };
        const reviewed = ["under_review", "certified", "approved", "paid", "rejected"].includes(inv.status) ? (a.pm ?? o.users.finance) : null;
        const certBy = certState ? (inv.id % 2 ? o.users.finance : o.users.finance2) : null;
        const certAt = certState ? `${addDays(inv.invoice_date, 6) > o.today ? o.today : addDays(inv.invoice_date, 6)} 15:30:00` : null;
        const year = inv.invoice_date.slice(0, 4);
        const ref = `${initials || "SUB"}/${year}/${String(100 + ((a.id * 37 + k * 13) % 880)).padStart(4, "0")}`;
        upd.run(money.gross, money.gross, money.subtotal, money.vat, CUR, VAT, a.ret || 0, a.adv || 0, r2(prevCert), certGross, ded.retention, ded.advance, ded.net, paid ? ded.net : 0, ref, sub.n, sub.e,
          inv.created_at.replace(" ", "T") + ".000Z", addDays(inv.invoice_date, a.days || 30), reviewed, certBy, certAt, paid ? `TRF-${year}-${String(400000 + inv.id * 17)}` : null, paid ? (inv.id % 7 === 0 ? "Cheque" : "Bank transfer") : null, inv.id);
        if (certState && inv.status !== "rejected") prevCert += certGross;
        if (paid && syncedLeft > 0 && inv.invoice_date < addDays(o.today, -120)) {
          db.prepare("UPDATE sub_invoices SET erp_sync_status='synced', erp_doc_no=?, erp_synced_at=? WHERE id=?").run(`AP-${year}-${String(1200 + inv.id)}`, `${addDays(inv.invoice_date, 40)}T09:00:00.000Z`, inv.id); syncedLeft--;
        } else if (paid && failedLeft > 0 && inv.invoice_date < addDays(o.today, -60)) {
          db.prepare("UPDATE sub_invoices SET erp_sync_status='failed', erp_error=? WHERE id=?").run(PROFILE.invoices.erpError, inv.id); failedLeft--;
        }
        if (long && (certState || longId === null)) longId = inv.id; // latest certified / approved / paid long invoice
        if (a.project_id === baseProject + 1 && !long && certState && cut < 0.5 && certLines.some((c) => c.remark) && lines.length >= 3) {
          const score = (inv.status === "paid" ? 2 : 1) + lines.length / 10;
          if (!showcase || score > showcase.score) showcase = { id: inv.id, score };
        }
        o.syncCost(inv.id); // posts the certified cost for approved/paid invoices, removes it otherwise
      });
      const setQty = db.prepare("UPDATE sub_invoice_lines SET contract_qty = ? WHERE item_code = ? AND invoice_id IN (SELECT id FROM sub_invoices WHERE assignment_id = ?)");
      for (const b of boq) setQty.run(b.contractQty, b.code, a.id);
    }
  })();
  return { longId, showcaseId: (showcase as { id: number } | null)?.id ?? null };
}

/* ------------------------------------------------------------------ documents */

type Rp = typeof import("@react-pdf/renderer");
const h = React.createElement;
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: currencyDecimals(CUR), maximumFractionDigits: currencyDecimals(CUR) });
const q3 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const ACCENTS = ["#1D4ED8", "#047857", "#B45309", "#475569", "#9333EA", "#BE123C", "#0F766E", "#4D7C0F"];

async function pdf(rp: Rp, doc: React.ReactElement): Promise<Buffer> { return rp.renderToBuffer(doc as never); }

function taxInvoicePdf(rp: Rp, d: any): React.ReactElement {
  const { Document, Page, Text, View } = rp;
  const accent = ACCENTS[d.sub_id % ACCENTS.length];
  const row = (cells: (string | number)[], w: number[], bold = false, bg?: string) =>
    h(View, { style: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 4, backgroundColor: bg, borderBottomWidth: 0.5, borderBottomColor: "#CBD5E1" }, wrap: false },
      ...cells.map((c, i) => h(Text, { key: i, style: { width: `${w[i]}%`, fontSize: 8, fontFamily: bold ? "Helvetica-Bold" : "Helvetica", textAlign: i >= 2 ? "right" : "left" } }, String(c))));
  const W = [6, 46, 10, 12, 12, 14];
  return h(Document, { title: `Tax invoice ${d.ref}` },
    h(Page, { size: "A4", style: { padding: 40, fontFamily: "Helvetica", fontSize: 9 } },
      h(View, { style: { borderBottomWidth: 2, borderBottomColor: accent, paddingBottom: 8, marginBottom: 12 } },
        h(Text, { style: { fontSize: 16, fontFamily: "Helvetica-Bold", color: accent } }, d.sub_name),
        h(Text, { style: { color: "#475569" } }, d.address ?? PROFILE.tenant.country),
        h(Text, { style: { color: "#475569" } }, `${TAXL}: ${d.tax_no ?? "—"}   Tel: ${d.phone ?? "—"}   ${d.email ?? ""}`)),
      h(Text, { style: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 8 } }, "TAX INVOICE"),
      h(View, { style: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 } },
        h(View, null, h(Text, { style: { fontFamily: "Helvetica-Bold" } }, "Invoice to"), h(Text, null, d.company), h(Text, null, d.company_address), h(Text, null, `${TAXL}: ${d.company_trn}`)),
        h(View, null, h(Text, null, `Invoice no: ${d.ref}`), h(Text, null, `Date: ${d.invoice_date}`), h(Text, null, `Period: ${d.period_from ?? "—"} to ${d.period_to ?? "—"}`), h(Text, null, `Project: ${d.project_code} / ${d.assignment_code}`))),
      row(["#", "Description", "Unit", "Qty", "Rate", "Amount"], W, true, "#E2E8F0"),
      ...d.lines.map((l: any, i: number) => row([i + 1, l.description, l.unit ?? "", q3(l.this_qty), money(l.rate), money(l.amount)], W)),
      h(View, { style: { alignSelf: "flex-end", width: 200, marginTop: 10 } },
        h(View, { style: { flexDirection: "row", justifyContent: "space-between" } }, h(Text, null, "Total (excl. VAT)"), h(Text, null, `${CUR} ${money(d.subtotal)}`)),
        h(View, { style: { flexDirection: "row", justifyContent: "space-between" } }, h(Text, null, `VAT ${VAT}%`), h(Text, null, `${CUR} ${money(d.vat_amount)}`)),
        h(View, { style: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, marginTop: 2, paddingTop: 2 } }, h(Text, { style: { fontFamily: "Helvetica-Bold" } }, "Total due"), h(Text, { style: { fontFamily: "Helvetica-Bold" } }, `${CUR} ${money(d.gross)}`))),
      h(Text, { style: { marginTop: 18, color: "#475569" } }, `Bank: ${d.bank_name ?? "—"}   Payment terms: ${d.payment_days} days from certification.`),
      h(View, { style: { marginTop: 36, width: 180, borderTopWidth: 1, paddingTop: 3 } }, h(Text, null, `For ${d.sub_name}`), h(Text, { style: { color: "#64748B", fontSize: 8 } }, "Authorised signatory"))));
}

function measurementPdf(rp: Rp, d: any): React.ReactElement {
  const { Document, Page, Text, View } = rp;
  const W = [8, 38, 10, 14, 14, 16];
  const row = (cells: (string | number)[], bold = false, bg?: string) =>
    h(View, { style: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 3, backgroundColor: bg, borderWidth: 0.5, borderColor: "#94A3B8", marginBottom: -0.5 }, wrap: false },
      ...cells.map((c, i) => h(Text, { key: i, style: { width: `${W[i]}%`, fontSize: 8, fontFamily: bold ? "Helvetica-Bold" : "Helvetica", textAlign: i >= 3 ? "right" : "left" } }, String(c))));
  return h(Document, { title: `Measurement sheet ${d.invoice_no}` },
    h(Page, { size: "A4", orientation: "landscape", style: { padding: 36, fontFamily: "Helvetica", fontSize: 9 } },
      h(Text, { style: { fontSize: 14, fontFamily: "Helvetica-Bold" } }, "Joint measurement sheet"),
      h(Text, { style: { color: "#475569", marginBottom: 10 } }, `${d.project_code} ${d.project_name}  ·  ${d.assignment_code}  ·  ${d.sub_name}  ·  Period ${d.period_from ?? "—"} to ${d.period_to ?? "—"}`),
      row(["Item", "Description / location", "Unit", "Previous", "This period", "Cumulative"], true, "#E2E8F0"),
      ...d.lines.map((l: any) => row([l.item_code ?? "", l.description, l.unit ?? "", q3(l.prev_qty), q3(l.this_qty), q3(l.cum_qty)])),
      h(View, { style: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 } },
        h(View, { style: { width: 200, borderTopWidth: 1, paddingTop: 3 } }, h(Text, null, "Measured by (subcontractor)")),
        h(View, { style: { width: 200, borderTopWidth: 1, paddingTop: 3 } }, h(Text, null, "Verified by (site engineer)")))));
}

function timesheetPdf(rp: Rp, d: any): React.ReactElement {
  const { Document, Page, Text, View } = rp;
  const crew = [["Foreman", 1, 9], ["Skilled labour", 4, 9], ["General labour", 6, 9], ["Operator (excavator)", 1, 9], ["Driver", 2, 8]] as const;
  const days = Array.from({ length: 6 }, (_, i) => `Day ${i + 1}`);
  const cell = (t: string, w: string, bold = false) => h(Text, { style: { width: w, fontSize: 8, fontFamily: bold ? "Helvetica-Bold" : "Helvetica" } }, t);
  return h(Document, { title: `Timesheet ${d.invoice_no}` },
    h(Page, { size: "A4", style: { padding: 40, fontFamily: "Helvetica", fontSize: 9 } },
      h(Text, { style: { fontSize: 14, fontFamily: "Helvetica-Bold" } }, "Crew timesheet"),
      h(Text, { style: { color: "#475569", marginBottom: 10 } }, `${d.sub_name}  ·  ${d.project_code}  ·  week ending ${d.period_to ?? d.invoice_date}`),
      h(View, { style: { flexDirection: "row", backgroundColor: "#E2E8F0", padding: 3 } }, cell("Trade", "28%", true), cell("Nr", "8%", true), ...days.map((x) => cell(x, "10.7%", true))),
      ...crew.map(([t, n, hrs], i) => h(View, { key: i, style: { flexDirection: "row", padding: 3, borderBottomWidth: 0.5, borderBottomColor: "#CBD5E1" } }, cell(t, "28%"), cell(String(n), "8%"), ...days.map((_, di) => cell(String(di === 5 ? Math.max(0, hrs - 4) : hrs), "10.7%")))),
      h(Text, { style: { marginTop: 14, color: "#64748B" } }, "Hours per person per day. Signed copy held on site.")));
}

function deliveryNotePdf(rp: Rp, d: any): React.ReactElement {
  const { Document, Page, Text, View } = rp;
  const mats = [["HDPE duct 110mm (6 m)", "pcs", 120], ["Duct couplers 110mm", "pcs", 130], ["Marker tape", "roll", 8], ["Sand bedding", "m³", 36]] as const;
  return h(Document, { title: `Delivery note ${d.invoice_no}` },
    h(Page, { size: "A4", style: { padding: 40, fontFamily: "Helvetica", fontSize: 9 } },
      h(Text, { style: { fontSize: 14, fontFamily: "Helvetica-Bold" } }, "Delivery note"),
      h(Text, { style: { color: "#475569", marginBottom: 10 } }, `DN-${d.assignment_code}-${d.invoice_no.slice(-2)}  ·  ${d.sub_name}  ·  ${d.project_code}  ·  ${d.invoice_date}`),
      ...mats.map(([m, u, qn], i) => h(View, { key: i, style: { flexDirection: "row", justifyContent: "space-between", padding: 3, borderBottomWidth: 0.5, borderBottomColor: "#CBD5E1" } }, h(Text, null, m), h(Text, null, `${qn + (d.line_count * 7) % 40} ${u}`))),
      h(Text, { style: { marginTop: 20, color: "#64748B" } }, "Received in good condition. Site storekeeper signature: ______________")));
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function photoSvg(kind: number, caption: string, stamp: string, seed: number): string {
  caption = esc(caption); stamp = esc(stamp);
  const W = 960, H = 640;
  const sky = ["#cfe8fb", "#f9d9a8", "#d7e3ee", "#bfe0f4"][kind % 4];
  const cones = Array.from({ length: 5 }, (_, i) => { const x = 90 + i * 150 + ((seed * 13 + i * 7) % 30); return `<polygon points="${x},470 ${x + 14},470 ${x + 7},440" fill="#f97316"/><rect x="${x + 1}" y="458" width="12" height="4" fill="#fff"/>`; }).join("");
  const scenes = [
    // open trench with ducts and excavator
    `<rect x="0" y="360" width="${W}" height="${H - 360}" fill="#c9a56e"/><rect x="120" y="430" width="720" height="60" fill="#7a5a33"/><rect x="140" y="446" width="680" height="9" rx="4" fill="#1e293b"/><rect x="140" y="462" width="680" height="9" rx="4" fill="#1e293b"/>
     <g transform="translate(560 250)"><rect x="0" y="80" width="150" height="46" rx="6" fill="#facc15"/><rect x="30" y="40" width="60" height="44" fill="#eab308"/><polyline points="90,60 170,0 230,40" fill="none" stroke="#eab308" stroke-width="12"/><polygon points="226,36 252,70 214,70" fill="#a16207"/><circle cx="30" cy="132" r="16" fill="#111827"/><circle cx="120" cy="132" r="16" fill="#111827"/></g>${cones}`,
    // completed reinstatement: asphalt strip and kerb
    `<rect x="0" y="360" width="${W}" height="${H - 360}" fill="#9ca3af"/><rect x="0" y="470" width="${W}" height="16" fill="#e5e7eb"/><rect x="0" y="486" width="${W}" height="150" fill="#374151"/><rect x="420" y="540" width="120" height="10" fill="#fff"/><rect x="620" y="540" width="120" height="10" fill="#fff"/><rect x="120" y="540" width="120" height="10" fill="#fff"/>
     <rect x="300" y="380" width="360" height="84" fill="#1f2937"/><rect x="300" y="380" width="360" height="84" fill="none" stroke="#f59e0b" stroke-width="3" stroke-dasharray="14 8"/>${cones}`,
    // handhole chamber
    `<rect x="0" y="360" width="${W}" height="${H - 360}" fill="#b89968"/><rect x="340" y="420" width="280" height="150" fill="#6b7280" stroke="#374151" stroke-width="6"/><rect x="360" y="440" width="240" height="110" fill="#111827"/><rect x="380" y="456" width="200" height="8" rx="4" fill="#f97316"/><rect x="380" y="478" width="200" height="8" rx="4" fill="#0ea5e9"/><rect x="380" y="500" width="200" height="8" rx="4" fill="#22c55e"/>
     <rect x="250" y="400" width="460" height="20" fill="#d1d5db"/>${cones}`,
    // pulling cable drum
    `<rect x="0" y="380" width="${W}" height="${H - 380}" fill="#cdb48a"/><circle cx="260" cy="400" r="95" fill="#92400e"/><circle cx="260" cy="400" r="60" fill="#78350f"/><circle cx="260" cy="400" r="14" fill="#451a03"/><path d="M345 420 C 520 470, 640 380, 900 450" stroke="#111827" stroke-width="10" fill="none"/>
     <g transform="translate(640 330)"><rect x="0" y="50" width="130" height="40" rx="6" fill="#2563eb"/><rect x="20" y="20" width="56" height="34" fill="#1d4ed8"/><circle cx="26" cy="96" r="14" fill="#111827"/><circle cx="104" cy="96" r="14" fill="#111827"/></g>${cones}`,
  ];
  const sun = kind % 4 === 1 ? `<circle cx="800" cy="120" r="46" fill="#fb923c" opacity=".85"/>` : `<circle cx="820" cy="110" r="38" fill="#fde68a"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${caption}"><rect width="${W}" height="${H}" fill="${sky}"/>${sun}<rect x="0" y="330" width="${W}" height="40" fill="#e7d3a8"/><polygon points="0,330 130,290 260,330" fill="#d6c093"/><polygon points="380,330 560,270 760,330" fill="#d9c49a"/>${scenes[kind % 4]}
<rect x="0" y="${H - 62}" width="${W}" height="62" fill="#0f172a" opacity=".82"/><text x="22" y="${H - 36}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#fff">${caption}</text><text x="22" y="${H - 12}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#cbd5e1">${stamp}</text></svg>`;
}

/** Async part: writes the attachment files and rows for every invoice. */
export async function seedInvoiceDocuments(db: DB, o: { uploads: string; entityId: number; users: { clerk: number }; company: { name: string; address: string; trn: string } }): Promise<number> {
  loadRegion();
  const rp = await import("@react-pdf/renderer");
  const invs = db.prepare(`SELECT i.id, i.invoice_no, i.invoice_date, i.period_from, i.period_to, i.sub_invoice_ref ref, i.subtotal, i.vat_amount, i.gross_amount gross, i.source, i.created_at,
      a.code assignment_code, a.payment_days, p.code project_code, p.name project_name, s.id sub_id, s.name sub_name, s.address, s.tax_no, s.phone, s.email, s.bank_name
    FROM sub_invoices i JOIN assignments a ON a.id = i.assignment_id JOIN projects p ON p.id = i.project_id JOIN subcontractors s ON s.id = a.subcontractor_id WHERE p.entity_id = ? ORDER BY i.id`).all(o.entityId) as any[];
  const ins = db.prepare("INSERT INTO attachments(entity_type, entity_id, category, filename, stored_path, mime, size, uploaded_by, note, created_at) VALUES ('sub_invoice',?,?,?,?,?,?,?,?,?)");
  const lines = db.prepare("SELECT * FROM sub_invoice_lines WHERE invoice_id = ? ORDER BY line_no");
  let files = 0;
  const put = (invId: number, category: string, filename: string, mime: string, data: Buffer | string, uploader: number | null, when: string, note: string | null) => {
    const stored = `seed-${nanoid(8)}-${filename}`;
    fs.writeFileSync(path.join(o.uploads, stored), data);
    ins.run(invId, category, filename, stored, mime, Buffer.byteLength(data as never), uploader, note, `${when} 10:00:00`);
    files++;
  };
  const safe = (s: string) => s.replace(/[^\w.\-]+/g, "-");
  for (const inv of invs) {
    const ls = lines.all(inv.id) as any[];
    const d = { ...inv, lines: ls, line_count: ls.length, company: o.company.name, company_address: o.company.address, company_trn: o.company.trn };
    const portal = inv.source === "portal";
    const uploader = portal ? null : o.users.clerk;
    const when = inv.invoice_date as string;
    put(inv.id, "tax_invoice", `${safe(inv.ref ?? inv.invoice_no)}.pdf`, "application/pdf", await pdf(rp, taxInvoicePdf(rp, d)), uploader, when, "Subcontractor's signed tax invoice");
    put(inv.id, "measurement_sheet", `Measurement-sheet-${safe(inv.invoice_no)}.pdf`, "application/pdf", await pdf(rp, measurementPdf(rp, d)), uploader, when, "Joint measurement sheet");
    const nPhotos = 2 + (inv.id % 3);
    for (let k = 0; k < nPhotos; k++) {
      const day = addDays(inv.period_to ?? inv.invoice_date, -(k * 3 + 1));
      const cap = `${inv.project_code} · ${ls[k % ls.length]?.description ?? "Site works"}`.slice(0, 64).replace(/&/g, "and");
      put(inv.id, "progress_photos", `site-photo-${k + 1}-${day}.svg`, "image/svg+xml", photoSvg(inv.id + k, cap, `${day}  ${String(7 + ((inv.id + k * 3) % 8)).padStart(2, "0")}:${String((inv.id * 7 + k * 11) % 60).padStart(2, "0")}  ·  ${inv.sub_name}`, inv.id * 3 + k), uploader, day, null);
    }
    if (inv.id % 3 === 0) put(inv.id, "timesheet", `Timesheet-${safe(inv.invoice_no)}.pdf`, "application/pdf", await pdf(rp, timesheetPdf(rp, d)), uploader, when, "Crew timesheet");
    if (inv.id % 6 === 2) put(inv.id, "delivery_note", `Delivery-note-${safe(inv.invoice_no)}.pdf`, "application/pdf", await pdf(rp, deliveryNotePdf(rp, d)), uploader, when, "Material delivery note");
  }
  return files;
}

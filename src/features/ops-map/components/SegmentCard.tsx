"use client";
import { AlertTriangle, ClipboardList, Copy, ExternalLink, FileText, X } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { RESP_COLOR, RESP_LABEL, STATUS_COLOR } from "../calc";
import type { OpsSegment, SegDerived } from "../types";
import { Bar, Dot, Sparkline, StatusPill, shortDate, slipColor, slipText } from "./bits";

const fmtQ = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v < 10 ? 2 : 1));

export default function SegmentCard({ seg, d, color, projectCode, portalUrl, onClose }: { seg: OpsSegment; d: SegDerived; color: string; projectCode: string; portalUrl: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const qty = seg.qty && seg.qty > 0 ? seg.qty : null;
  const unitQty = (pctWk: number) => (qty ? (pctWk / 100) * qty : null);
  const rateQ = unitQty(d.ratePctWk), reqQ = unitQty(d.reqPctWk);
  const behindRate = d.reqPctWk > d.ratePctWk * 1.02 && d.actualPct < 99.5;
  const done = qty ? (d.actualPct / 100) * qty : null;
  const rating = seg.sub?.rating;
  return (
    <div className="om-glass om-pop flex min-h-0 flex-col overflow-hidden" role="dialog" aria-label="Segment details">
      <div className="flex items-start gap-3 px-4 pb-2 pt-3.5" style={{ borderTop: `3px solid ${color}`, borderRadius: "16px 16px 0 0" }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><StatusPill s={d.status} />{d.active && <span className="om-chip" style={{ color: "#22C55E" }}><span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />Crew active</span>}</div>
          <div className="mt-1.5 truncate text-[15px] font-extrabold leading-tight">{seg.sub?.name ?? "Self-performed"}</div>
          <div className="om-muted truncate text-[11.5px] font-semibold">{projectCode} · {seg.stageCode} {seg.chainFrom !== null && seg.chainTo !== null ? `· km ${seg.chainFrom.toFixed(1)} – ${seg.chainTo.toFixed(1)}` : ""}{rating ? ` · ★ ${rating.toFixed(1)}` : ""}</div>
        </div>
        <button type="button" className="om-btn !h-7 !w-7 !px-0" onClick={onClose} aria-label="Close segment card"><X size={14} /></button>
      </div>
      <div className="om-scroll min-h-0 flex-1 space-y-3 px-4 pb-3">
        {seg.scope && <p className="om-muted line-clamp-2 text-[12px] font-medium leading-snug">{seg.scope}</p>}
        <div>
          <div className="mb-1.5 flex items-end justify-between"><span className="om-num text-[22px] font-extrabold leading-none" style={{ color }}>{d.actualPct.toFixed(0)}%</span><span className="om-muted om-num text-[11.5px] font-bold">plan {d.plannedPct.toFixed(0)}% · SPI <b style={{ color: d.spi !== null && d.spi < 0.85 ? "#EF4444" : d.spi !== null && d.spi < 0.95 ? "#F59E0B" : "var(--om-fg)" }}>{d.spi === null ? "—" : d.spi.toFixed(2)}</b></span></div>
          <Bar actual={d.actualPct} planned={d.plannedPct} color={color} h={8} />
          {done !== null && qty && <div className="om-muted om-num mt-1.5 text-[11px] font-semibold">{fmtQ(done)} of {fmtQ(qty)} {seg.unit} done</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="om-soft rounded-xl px-3 py-2"><div className="om-h">Planned end</div><div className="om-num text-[13px] font-extrabold">{shortDate(seg.plannedEnd)}</div></div>
          <div className="om-soft rounded-xl px-3 py-2"><div className="om-h">{d.status === "completed" ? "Finished" : "Projected end"}</div><div className="om-num text-[13px] font-extrabold">{shortDate(d.projectedEnd)} <span style={{ color: slipColor(d.slipDays) }} className="text-[11px]">{d.status === "completed" ? "" : slipText(d.slipDays)}</span></div></div>
        </div>
        {d.actualPct < 99.5 && (
          <div className="rounded-xl px-3 py-2.5" style={{ background: behindRate ? "rgba(239,68,68,.1)" : "rgba(34,197,94,.1)" }}>
            <div className="om-h">Work rate · now vs needed</div>
            <div className="om-num mt-0.5 text-[13px] font-extrabold">
              {rateQ !== null ? `${fmtQ(rateQ)} ${seg.unit}/wk` : `${d.ratePctWk.toFixed(1)} %/wk`}
              <span className="om-muted mx-1.5 font-semibold">now ·</span>
              <span style={{ color: behindRate ? "#EF4444" : "#22C55E" }}>needs {reqQ !== null ? `${fmtQ(reqQ)} ${seg.unit}/wk` : `${d.reqPctWk.toFixed(1)} %/wk`}</span>
            </div>
            {d.overdue && <div className="mt-0.5 text-[11px] font-bold" style={{ color: "#EF4444" }}>Past planned end date</div>}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div><div className="om-h">Manpower · last 4 wks</div><div className="om-num mt-0.5 text-[11px] font-bold">{d.manpower.map((m) => m || "–").join(" · ")}</div></div>
          <Sparkline values={d.manpower} color={color} />
        </div>
        <div className="flex items-center justify-between text-[12px] font-semibold">
          <span className="om-muted">Last report</span>
          <span className="om-num font-extrabold" style={{ color: d.staleDays !== null && d.staleDays > 14 ? "#EF4444" : d.staleDays !== null && d.staleDays > 10 ? "#F59E0B" : undefined }}>{d.lastReport ? `${shortDate(d.lastReport)} · ${d.staleDays === 0 ? "today" : `${d.staleDays} d ago`}` : "none yet"}</span>
        </div>
        {seg.assignmentId && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {([["Contract", seg.contractValue], ["Certified", seg.invoices.certified], ["Paid", seg.invoices.paid]] as const).map(([l, v]) => (
              <div key={l} className="om-soft rounded-xl px-2 py-1.5"><div className="om-h">{l}</div><div className="om-num text-[12px] font-extrabold">{formatMoney(v, { compact: true })}</div></div>
            ))}
          </div>
        )}
        {Object.keys(d.delayByResp).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(d.delayByResp).sort((a, b) => b[1] - a[1]).map(([r, v]) => <span key={r} className="om-chip" style={{ background: `${RESP_COLOR[r]}22`, color: RESP_COLOR[r] }}>{RESP_LABEL[r]} {v} d</span>)}
          </div>
        )}
        {d.openIssues.length > 0 && (
          <div>
            <div className="om-h mb-1 flex items-center gap-1"><AlertTriangle size={11} />Open issues ({d.openIssues.length})</div>
            <div className="space-y-1">{d.openIssues.slice(0, 3).map((i) => (
              <div key={i.id} className="flex items-start gap-2 text-[11.5px] font-semibold leading-snug"><span className="mt-1"><Dot c={RESP_COLOR[i.resp]} size={7} /></span><span className="min-w-0 flex-1">{i.title}{i.impactDays > 0 && <span className="om-muted"> · {i.impactDays} d</span>}</span></div>
            ))}</div>
          </div>
        )}
      </div>
      <div className="om-line flex flex-wrap gap-1.5 border-t px-3 py-2.5">
        <a className="om-btn !h-8 !text-[11.5px]" href={`/projects/${seg.projectId}?tab=stages`}><ExternalLink size={12} />Open stage</a>
        <a className="om-btn !h-8 !text-[11.5px]" href={`/projects/${seg.projectId}?tab=progress`}><ClipboardList size={12} />Progress reports</a>
        {portalUrl && (
          <button type="button" className="om-btn !h-8 !text-[11.5px]" onClick={() => { void navigator.clipboard?.writeText(portalUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}><Copy size={12} />{copied ? "Copied" : "Copy portal link"}</button>
        )}
        {!portalUrl && <span className="om-muted inline-flex items-center gap-1 px-1 text-[11px] font-semibold"><FileText size={11} />No portal link</span>}
      </div>
      <span className="hidden" style={{ color: STATUS_COLOR[d.status] }} />
    </div>
  );
}

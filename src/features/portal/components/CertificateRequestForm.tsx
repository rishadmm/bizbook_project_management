"use client";
import { AlertTriangle, BadgeCheck, Check, Circle, FileText, Flag, Gauge, KeyRound, Layers, MapPin, Paperclip, ShieldCheck, StickyNote, Upload, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { useServerForm } from "@/components/useServerForm";
import { Field, Select } from "@/components/ui";
import { requestCertificate, type WorkState } from "../work-actions";

export interface CertAsg {
  id: number; code: string; label: string; projectCode: string; projectName: string; stageName: string | null; actualPct: number;
  pending: { id: number; certNo: string | null; type: string } | null; issued: number;
}
export interface CertTypeOption { value: string; label: string }

const MAX = 15 * 1024 * 1024;
const TYPE_META: Record<string, { Icon: LucideIcon; hint: string; strict?: boolean }> = {
  partial: { Icon: Gauge, hint: "Part of the work is complete. Use it to be recognised for a finished section while the rest continues." },
  substantial: { Icon: ShieldCheck, hint: "The works are essentially finished and usable, apart from minor snags.", strict: true },
  final: { Icon: BadgeCheck, hint: "All work, snags and handover documents are complete. Closes the subcontract.", strict: true },
  taking_over: { Icon: KeyRound, hint: "The client is taking over the completed works for use or operation." },
};
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const subLabel = "mb-1.5 block text-xs font-bold text-slate-600";
const chip = "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

function Section({ n, icon: Icon, title, hint, children }: { n: number; icon: LucideIcon; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white shadow-card" aria-labelledby={`cert-sec-${n}`}>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary"><Icon size={18} aria-hidden /></span>
        <div className="min-w-0">
          <h3 id={`cert-sec-${n}`} className="text-sm font-extrabold tracking-tight text-dark"><span className="mr-1.5 text-primary">{n}</span>{title}</h3>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </header>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Portal "Request completion certificate" page form. Posts the same fields as the legacy RequestCertificateForm (assignment_id, cert_type, percent, file, remarks). */
export default function CertificateRequestForm({ assignments, certTypes, defaultAssignment, cancelHref }: { assignments: CertAsg[]; certTypes: CertTypeOption[]; defaultAssignment?: number; cancelHref: string }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(requestCertificate, undefined);
  const first = assignments.find((a) => a.id === defaultAssignment) ?? assignments[0];
  const [asg, setAsg] = useState(first?.id);
  const [type, setType] = useState(certTypes.some((t) => t.value === "partial") ? "partial" : certTypes[0]?.value ?? "partial");
  const [pct, setPct] = useState(String(Math.round(first?.actualPct ?? 0)));
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const cur = assignments.find((a) => a.id === asg);
  const verified = Math.round((cur?.actualPct ?? 0) * 10) / 10;
  const req = Math.max(0, Math.min(100, Number(pct) || 0));
  const over = req > verified + 5;
  const strict = !!TYPE_META[type]?.strict;
  const lowForType = strict && verified < 95;
  const useTiles = assignments.length <= 6;
  const typeLabel = certTypes.find((t) => t.value === type)?.label ?? type;
  const checks = [
    { ok: !!cur, text: "Subcontract selected" }, { ok: pct !== "" && req >= 0, text: "Completion % entered" },
    { ok: !!file, text: "Supporting document (recommended)" }, { ok: remarks.trim().length > 0, text: "Remarks (recommended)" },
  ];

  const pick = (a: CertAsg) => { setAsg(a.id); setPct(String(Math.round(a.actualPct))); };
  const applyFile = (f: File | null) => {
    const el = fileRef.current;
    if (f && f.size > MAX) { setFileErr(`${f.name} is larger than 15 MB`); if (el) el.value = ""; setFile(null); return; }
    setFileErr("");
    if (el && f && el.files?.[0] !== f) { const dt = new DataTransfer(); dt.items.add(f); el.files = dt.files; }
    if (!f && el) el.value = "";
    setFile(f);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); applyFile(e.dataTransfer.files[0] ?? null); };

  const submitBtn = (cls: string) => (
    <button type="submit" disabled={pending} className={`inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-brand transition hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-60 ${cls}`}>{pending ? "Sending…" : "Request certificate"}</button>
  );
  const tile = (a: CertAsg, selected: boolean) => (
    <span className={`flex h-full cursor-pointer flex-col gap-2 rounded-xl border-[1.5px] p-3 transition ${selected ? "border-primary bg-primary-50/60 ring-4 ring-primary/10" : "border-line bg-white hover:border-primary/50"}`}>
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0"><span className="block truncate text-sm font-extrabold text-dark">{a.code}</span>
          <span className="block truncate text-xs text-slate-500">{a.projectCode}{a.stageName ? ` · ${a.stageName}` : ""}</span></span>
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary bg-primary text-white" : "border-slate-300"}`}>{selected && <Check size={12} strokeWidth={3} />}</span>
      </span>
      <span className="mt-auto block">
        <span className="relative block h-1.5 overflow-hidden rounded-full bg-slate-200"><span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${Math.min(100, a.actualPct)}%` }} /></span>
        <span className="mt-1 block text-[11px] tabular-nums text-slate-500">{a.actualPct.toFixed(0)}% complete (verified)</span>
      </span>
      {a.pending ? <span className="inline-flex items-center gap-1 self-start rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700"><AlertTriangle size={11} aria-hidden />Request pending</span>
        : a.issued > 0 ? <span className="inline-flex items-center gap-1 self-start rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-700"><Check size={11} aria-hidden />{a.issued} certificate{a.issued === 1 ? "" : "s"} issued</span>
        : <span className="text-[11px] text-slate-400">No certificate yet</span>}
    </span>
  );

  return (
    <form onSubmit={onSubmit} data-action-form="" data-testid="cert-request-form" className="pb-28 md:pb-0">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start">
        <div className="space-y-5">
          <Section n={1} icon={MapPin} title="Subcontract" hint="Which subcontract is this certificate for?">
            {useTiles ? (
              <fieldset>
                <legend className={subLabel}>Subcontract</legend>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {assignments.map((a) => (
                    <label key={a.id} className="block rounded-xl focus-within:ring-4 focus-within:ring-primary/25">
                      <input type="radio" name="assignment_id" value={a.id} checked={asg === a.id} onChange={() => pick(a)} className="sr-only" required />
                      {tile(a, asg === a.id)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <>
                <Field label="Subcontract"><Select name="assignment_id" value={asg} onChange={(e) => { const a = assignments.find((x) => x.id === Number(e.target.value)); if (a) pick(a); }} options={assignments.map((a) => ({ value: a.id, label: a.label }))} required /></Field>
                {cur && <div className="sm:w-1/2">{tile(cur, true)}</div>}
              </>
            )}
            {cur?.pending && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>A certificate request ({cur.pending.certNo ?? `#${cur.pending.id}`}) is already waiting for review on this subcontract. You can still send another, but check it is not a duplicate.</span></p>
            )}
          </Section>

          <Section n={2} icon={Layers} title="Certificate type" hint="Choose the milestone you are asking the project team to certify.">
            <fieldset>
              <legend className="sr-only">Certificate type</legend>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {certTypes.map((t) => {
                  const m = TYPE_META[t.value] ?? { Icon: Flag, hint: "Completion milestone agreed with the project team." };
                  const on = type === t.value;
                  return (
                    <label key={t.value} className="block rounded-xl focus-within:ring-4 focus-within:ring-primary/25">
                      <input type="radio" name="cert_type" value={t.value} checked={on} onChange={() => setType(t.value)} className="sr-only" />
                      <span className={`flex h-full cursor-pointer items-start gap-3 rounded-xl border-[1.5px] p-3 transition ${on ? "border-primary bg-primary-50/60 ring-4 ring-primary/10" : "border-line bg-white hover:border-primary/50"}`}>
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-primary text-white" : "bg-slate-100 text-primary"}`}><m.Icon size={20} aria-hidden /></span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-dark">{t.label}</span><span className="mt-0.5 block text-xs leading-snug text-slate-500">{m.hint}</span></span>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-primary bg-primary text-white" : "border-slate-300"}`}>{on && <Check size={12} strokeWidth={3} />}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {lowForType && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>A {typeLabel.toLowerCase()} certificate normally follows near-complete work, but verified progress is only {verified.toFixed(0)}%. Report remaining progress first, or explain in the remarks.</span></p>
            )}
          </Section>

          <Section n={3} icon={Gauge} title="Completion" hint="How complete is the work you are asking to certify?">
            <div>
              <label htmlFor="cert-pct" className={subLabel}>Completion percentage</label>
              <div className="relative sm:max-w-xs">
                <input id="cert-pct" type="number" name="percent" step="0.1" min="0" max="100" inputMode="decimal" required value={pct} onChange={(e) => setPct(e.target.value)} aria-describedby="cert-pct-help"
                  className="block w-full rounded-xl border-[1.5px] border-[#e2e8f0] bg-white py-3 pl-4 pr-12 text-2xl font-extrabold tabular-nums text-dark placeholder:text-slate-300 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15" placeholder="0" />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-slate-400">%</span>
              </div>
              <input type="range" min={0} max={100} step={1} value={req} onChange={(e) => setPct(e.target.value)} aria-label="Completion percentage slider" className="mt-3 block w-full accent-primary" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setPct(String(Math.round(verified)))} className={chip}><Gauge size={13} aria-hidden />Use reported progress ({verified.toFixed(0)}%)</button>
                <button type="button" onClick={() => setPct("100")} className={chip}>100%</button>
              </div>
              <p id="cert-pct-help" className="mt-1.5 text-[11px] text-slate-400">Verified progress comes from reports the project team has accepted.</p>
            </div>
            <div>
              <div className="relative h-4 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`Requested ${req.toFixed(0)} percent, verified ${verified.toFixed(0)} percent`}>
                <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${Math.min(100, verified)}%` }} />
                {req > verified && <div className={`absolute inset-y-0 ${over ? "bg-amber-400" : "bg-[repeating-linear-gradient(45deg,#a5a0ff_0_5px,#c7c4ff_5px_10px)]"}`} style={{ left: `${Math.min(100, verified)}%`, width: `${req - Math.min(100, verified)}%` }} />}
                {req < verified && <div className="absolute -top-0.5 bottom-[-2px] w-0.5 bg-slate-800" style={{ left: `${req}%` }} />}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-primary" />Verified {verified.toFixed(0)}%</span>
                <span className="inline-flex items-center gap-1"><i className={`h-2 w-2 rounded-sm ${over ? "bg-amber-400" : "bg-primary/40"}`} />Requested {req.toFixed(0)}%</span>
              </div>
            </div>
            {over && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                <span>You are requesting {req.toFixed(0)}%, which is {(req - verified).toFixed(0)} points above verified progress ({verified.toFixed(0)}%). You can still send it, but the project team may return it.</span></p>
            )}
          </Section>

          <Section n={4} icon={Paperclip} title="Supporting documents" hint="Attach a completion report, snag list or measurement sheet (optional).">
            <input ref={fileRef} id="cert-file" type="file" name="file" aria-label="Supporting file" accept=".pdf,image/*,.xlsx,.xls,.csv,.doc,.docx" className="sr-only" onChange={(e) => applyFile(e.target.files?.[0] ?? null)} />
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
              className={`rounded-xl border-[1.5px] p-3 transition ${file ? "border-primary/50 bg-primary-50/40" : drag ? "border-dashed border-primary bg-primary-50" : "border-dashed border-slate-300 bg-slate-50/60"}`}>
              <div className="flex items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${file ? "bg-primary text-white" : "bg-white text-primary shadow-sm"}`}>{file ? <Check size={18} aria-hidden /> : <FileText size={18} aria-hidden />}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-extrabold text-dark">Completion evidence</div>
                  {file ? (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><span className="min-w-0 truncate font-semibold">{file.name}</span><span className="shrink-0 tabular-nums text-slate-400">{size(file.size)}</span></div>
                  ) : <p className="mt-0.5 text-xs text-slate-500">PDF, images, Word or Excel, maximum 15 MB.</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label htmlFor="cert-file" className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-[1.5px] border-primary bg-white px-2.5 py-1.5 text-xs font-bold text-primary hover:bg-primary-50 focus-within:ring-4 focus-within:ring-primary/20">
                      {file ? <Paperclip size={13} aria-hidden /> : <Upload size={13} aria-hidden />}{file ? "Replace" : "Choose file or drop here"}</label>
                    {file && <button type="button" onClick={() => applyFile(null)} aria-label={`Remove ${file.name}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><X size={13} />Remove</button>}
                  </div>
                  {fileErr && <p className="mt-1.5 text-xs font-semibold text-red-600" role="alert">{fileErr}</p>}
                </div>
              </div>
            </div>
          </Section>

          <Section n={5} icon={StickyNote} title="Remarks" hint="Describe the completed work so the reviewer can verify it quickly.">
            <div>
              <textarea id="cert-remarks" name="remarks" rows={4} maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} aria-label="Remarks"
                placeholder="e.g. Section km 6.1–7.4 completed including reinstatement; snag list attached."
                className="block w-full rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-dark focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15" />
              <div className="mt-1 text-right text-[11px] tabular-nums text-slate-400">{remarks.length} / 1000</div>
            </div>
          </Section>
        </div>

        <aside className="xl:sticky xl:top-20" aria-label="Certificate summary">
          <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            <div className="bg-gradient-to-br from-primary to-primary-dark px-5 py-3 text-white">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">Request summary</div>
              <div className="mt-0.5 truncate text-base font-extrabold">{cur?.code ?? "No subcontract"}</div>
              <div className="truncate text-xs text-white/80">{cur?.projectCode}{cur?.projectName ? ` · ${cur.projectName}` : ""}</div>
            </div>
            <dl className="space-y-1.5 px-5 py-3 text-sm">
              {[["Type", typeLabel], ["Requested", `${req.toFixed(1)}%`], ["Verified", `${verified.toFixed(1)}%`], ["File", file ? file.name : "None"]].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-slate-500">{k}</dt><dd className={`min-w-0 truncate text-right font-bold tabular-nums ${k === "Requested" && over ? "text-amber-600" : "text-dark"}`} title={v}>{v}</dd></div>
              ))}
            </dl>
            <ul className="space-y-1.5 border-t border-line px-5 py-3 text-sm">
              {checks.map((c) => (
                <li key={c.text} className={`flex items-center gap-2 ${c.ok ? "text-dark" : "text-slate-400"}`}>
                  {c.ok ? <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-success text-white"><Check size={11} strokeWidth={3} /></span> : <Circle size={18} className="text-slate-300" />}{c.text}
                </li>
              ))}
            </ul>
            <div className="hidden space-y-2 border-t border-line px-5 py-3 md:block">
              {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{state.error}</p>}
              {submitBtn("w-full")}
              <Link href={cancelHref} className="block text-center text-xs font-bold text-slate-500 hover:text-primary">Cancel</Link>
            </div>
          </div>
          <p className="mt-2 hidden px-1 text-[11px] text-slate-400 md:block"><ShieldCheck size={11} className="mr-1 inline" />The project team reviews every request before a certificate is issued.</p>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-[52px] z-[1100] border-t border-line bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        {state?.error && <p role="alert" className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{state.error}</p>}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs"><div className="truncate font-extrabold tabular-nums text-dark">{typeLabel} · {req.toFixed(0)}%</div><div className={`truncate ${over ? "font-bold text-amber-600" : "text-slate-500"}`}>{cur?.code}{cur ? ` · verified ${verified.toFixed(0)}%` : ""}</div></div>
          <Link href={cancelHref} className="text-xs font-bold text-slate-500">Cancel</Link>
          {submitBtn("shrink-0")}
        </div>
      </div>
    </form>
  );
}

"use client";
import { AlertTriangle, Camera, CalendarDays, Check, Circle, Cloud, CloudFog, CloudRain, ClipboardList, Hammer, ImagePlus, Layers, MapPin, Ruler, Sun, Thermometer, Wind, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useServerForm } from "@/components/useServerForm";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { submitProgress, type WorkState } from "../work-actions";
import RowsEditor, { type RowPreset } from "./RowsEditor";

export interface AsgOption {
  id: number; label: string; unit: string; quantity: number | null; reported: number;
  code?: string; projectCode?: string; projectName?: string; stageName?: string | null; plannedPct?: number | null; lastReportDate?: string | null;
}
export interface ReportPrefill {
  id: number; assignment_id: number; report_date: string; quantity_done: number; work_done: string | null; issues: string | null; delay_days: number; delay_cause: string | null; delay_responsibility: string; weather: string | null;
  manpower: { trade: string; headcount: number; hours: number }[]; materials: { material: string; unit: string | null; quantity: number }[]; equipment: string | null; reject_reason: string | null;
}
const WEATHER: { v: string; Icon: LucideIcon }[] = [
  { v: "Clear", Icon: Sun }, { v: "Hot / humid", Icon: Thermometer }, { v: "Dusty / windy", Icon: Wind }, { v: "Overcast", Icon: Cloud }, { v: "Rain", Icon: CloudRain }, { v: "Fog", Icon: CloudFog },
];
const MP_PRESETS: RowPreset[] = ["Labourer", "Operator", "Foreman", "Pipe fitter", "Welder", "Electrician", "Driver", "Surveyor"].map((t) => ({ label: t, values: { mp_trade: t } }));
const EQ_PRESETS: RowPreset[] = ["Excavator", "Backhoe loader", "Roller", "Dump truck", "Trencher", "Mobile crane", "Water tanker"].map((t) => ({ label: t, values: { eq_name: t, eq_qty: "1" } }));
const MAT_PRESETS: RowPreset[] = [["HDPE duct", "m"], ["Concrete", "m³"], ["Sand", "m³"], ["Asphalt", "t"], ["Cable", "m"]].map(([t, u]) => ({ label: `${t} (${u})`, values: { mat_name: t, mat_unit: u } }));
const MAX_PHOTO = 15 * 1024 * 1024;
const num = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const addDaysISO = (iso: string, d: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const dateLabel = (iso: string) => { const t = new Date(`${iso}T00:00:00Z`); return Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }); };

function Section({ n, icon: Icon, title, hint, children }: { n: number; icon: LucideIcon; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white shadow-card" aria-labelledby={`sec-${n}`}>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary"><Icon size={18} aria-hidden /></span>
        <div className="min-w-0">
          <h3 id={`sec-${n}`} className="text-sm font-extrabold tracking-tight text-dark"><span className="mr-1.5 text-primary">{n}</span>{title}</h3>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </header>
      <div className="space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}
const chip = (on: boolean) => `inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition focus-within:ring-2 focus-within:ring-primary/30 ${on ? "border-primary bg-primary text-white shadow-brand-sm" : "border-line bg-white text-slate-600 hover:border-primary hover:text-primary"}`;
const subLabel = "mb-1.5 block text-xs font-bold text-slate-600";

interface Photo { id: number; file: File; url: string }

/** New progress update, or correction + resubmission of a rejected one (`prefill`). Photos: camera capture, gallery pick and drag & drop (all posted as `photos`). */
export default function ProgressUpdateForm({ assignments, defaultAssignment, today, responsibilities, prefill, cancelHref }: {
  assignments: AsgOption[]; defaultAssignment?: number; today: string; responsibilities: { value: string; label: string }[]; prefill?: ReportPrefill; cancelHref?: string;
}) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(submitProgress, undefined);
  const [asg, setAsg] = useState(prefill?.assignment_id ?? defaultAssignment ?? assignments[0]?.id);
  const [date, setDate] = useState(prefill?.report_date ?? today);
  const [qty, setQty] = useState(prefill ? String(prefill.quantity_done) : "");
  const [weather, setWeather] = useState(prefill?.weather ?? "");
  const [work, setWork] = useState(prefill?.work_done ?? "");
  const [hasIssues, setHasIssues] = useState(!!(prefill && (prefill.issues || prefill.delay_days > 0 || (prefill.delay_cause ?? ""))));
  const [raise, setRaise] = useState(false);
  const [mp, setMp] = useState<Record<string, string>[]>([]);
  const [eq, setEq] = useState<Record<string, string>[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoMsg, setPhotoMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const urls = useRef<string[]>([]);

  const cur = assignments.find((a) => a.id === asg);
  const unit = cur?.unit ?? "";
  const total = cur?.quantity ?? 0;
  const q = Number(qty) || 0;
  const cum = (cur?.reported ?? 0) + q;
  const remaining = total ? Math.max(0, total - (cur?.reported ?? 0) - q) : 0;
  const over = !!total && cum > total * 1.0001;
  const pctOf = (n: number) => (total ? Math.min(100, (n / total) * 100) : 0);
  const reportedPct = pctOf(cur?.reported ?? 0);
  const thisPct = over ? Math.max(0, 100 - reportedPct) : pctOf(q);
  const crew = useMemo(() => ({ heads: mp.reduce((a, r) => a + (Number(r.mp_count) || 0), 0), hours: mp.reduce((a, r) => a + (Number(r.mp_hours) || 0), 0), has: mp.some((r) => (r.mp_trade ?? "").trim() || Number(r.mp_count) > 0) }), [mp]);
  const eqCount = eq.filter((r) => (r.eq_name ?? "").trim()).length;

  // Keep the hidden `photos` input (the one in the FormData) in sync with the selected files; release thumbnails on unmount.
  useEffect(() => {
    if (!hidden.current) return;
    const dt = new DataTransfer();
    photos.forEach((p) => dt.items.add(p.file));
    hidden.current.files = dt.files;
  }, [photos]);
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const ok: Photo[] = []; const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (!f.type.startsWith("image/")) bad.push(`${f.name} is not an image`);
      else if (f.size > MAX_PHOTO) bad.push(`${f.name} is larger than 15 MB`);
      else { const url = URL.createObjectURL(f); urls.current.push(url); ok.push({ id: nextId.current++, file: f, url }); }
    }
    setPhotoMsg(bad.length ? `Not added: ${bad.join("; ")}.` : "");
    if (ok.length) setPhotos((p) => [...p, ...ok]);
  };
  const removePhoto = (p: Photo) => { URL.revokeObjectURL(p.url); urls.current = urls.current.filter((u) => u !== p.url); setPhotos((ps) => ps.filter((x) => x.id !== p.id)); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); };

  const useTiles = assignments.length <= 6;
  const label = prefill ? "Resubmit report" : "Submit progress update";
  const checks = [
    { ok: q > 0, text: "Quantity entered" }, { ok: crew.has, text: "Manpower listed" }, { ok: work.trim().length > 0, text: "Work description" }, { ok: photos.length > 0, text: "Photos added (recommended)" },
  ];
  const submitBtn = (cls: string) => (
    <button type="submit" disabled={pending} className={`inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-brand transition hover:bg-primary-dark focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-60 ${cls}`}>{pending ? "Submitting…" : label}</button>
  );
  const tile = (a: AsgOption, selected: boolean, locked: boolean) => {
    const pct = a.quantity ? Math.min(100, (a.reported / a.quantity) * 100) : 0;
    return (
      <span className={`flex h-full flex-col gap-2 rounded-xl border-[1.5px] p-3 transition ${selected ? "border-primary bg-primary-50/60 ring-4 ring-primary/10" : "border-line bg-white hover:border-primary/50"} ${locked ? "opacity-90" : "cursor-pointer"}`}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0"><span className="block truncate text-sm font-extrabold text-dark">{a.code ?? a.label}</span>
            <span className="block truncate text-xs text-slate-500">{a.projectCode}{a.stageName ? ` · ${a.stageName}` : ""}</span></span>
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary bg-primary text-white" : "border-slate-300"}`}>{selected && <Check size={12} strokeWidth={3} />}</span>
        </span>
        {a.quantity ? (
          <span className="mt-auto block">
            <span className="relative block h-1.5 overflow-hidden rounded-full bg-slate-200"><span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} /></span>
            <span className="mt-1 block text-[11px] tabular-nums text-slate-500">{num(a.reported)} of {num(a.quantity)} {a.unit}{a.lastReportDate ? ` · last ${dateLabel(a.lastReportDate)}` : ""}</span>
          </span>
        ) : <span className="mt-auto block text-[11px] text-slate-500">Lump-sum subcontract</span>}
      </span>
    );
  };

  return (
    <form onSubmit={onSubmit} data-action-form="" data-testid="progress-form" className="pb-28 lg:pb-0">
      {prefill && <input type="hidden" name="report_id" value={prefill.id} />}
      <input ref={hidden} type="file" name="photos" multiple className="hidden" tabIndex={-1} aria-hidden />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-5">
          <Section n={1} icon={MapPin} title="Subcontract & date" hint="Which subcontract are you reporting on, and for which day?">
            {prefill ? (
              <>
                <input type="hidden" name="assignment_id" value={asg} />
                <div className="grid gap-2.5 sm:grid-cols-2">{cur && tile(cur, true, true)}</div>
                <p className="text-xs text-slate-500">The subcontract cannot be changed when correcting a report.</p>
              </>
            ) : useTiles ? (
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
            <div>
              <Field label="Report date"><Input type="date" name="report_date" value={date} onChange={(e) => setDate(e.target.value)} max={today} required className="sm:!w-56" /></Field>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[["Today", today], ["Yesterday", addDaysISO(today, -1)]].map(([t, d]) => (
                  <button key={t} type="button" aria-pressed={date === d} onClick={() => setDate(d)} className={`${chip(date === d)} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30`}><CalendarDays size={13} />{t}</button>
                ))}
              </div>
            </div>
          </Section>

          <Section n={2} icon={Ruler} title="Work quantity" hint="How much was completed in this reporting period?">
            <div>
              <label htmlFor="qty" className={subLabel}>Quantity this update</label>
              <div className="relative">
                <input id="qty" type="number" name="quantity_done" step="any" min="0" inputMode="decimal" required value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={over} placeholder="0"
                  className={`block w-full rounded-xl border-[1.5px] bg-white py-3 pl-4 pr-20 text-2xl font-extrabold tabular-nums text-dark placeholder:text-slate-300 focus:outline-none focus:ring-4 ${over ? "border-red-400 focus:border-red-500 focus:ring-red-200" : "border-[#e2e8f0] focus:border-primary focus:ring-primary/15"}`} />
                {unit && <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-bold text-slate-400">{unit}</span>}
              </div>
            </div>
            {total > 0 ? (
              <div>
                <div className="relative h-4 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`Reported ${num(cur?.reported ?? 0)}, this update ${num(q)}, remaining ${num(remaining)} of ${num(total)} ${unit}`}>
                  <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${reportedPct}%` }} />
                  <div className={`absolute inset-y-0 ${over ? "bg-red-500" : "bg-[repeating-linear-gradient(45deg,#a5a0ff_0_5px,#c7c4ff_5px_10px)]"}`} style={{ left: `${reportedPct}%`, width: `${thisPct}%` }} />
                  {cur?.plannedPct != null && <div className="absolute -top-0.5 bottom-[-2px] w-0.5 bg-slate-800" style={{ left: `${cur.plannedPct}%` }} title={`Planned to date ${cur.plannedPct.toFixed(0)}%`} />}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-primary" />Reported</span>
                  <span className="inline-flex items-center gap-1"><i className={`h-2 w-2 rounded-sm ${over ? "bg-red-500" : "bg-primary/40"}`} />This update</span>
                  <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-slate-200" />Remaining</span>
                  {cur?.plannedPct != null && <span className="inline-flex items-center gap-1"><i className="h-2.5 w-0.5 bg-slate-800" />Planned {cur.plannedPct.toFixed(0)}%</span>}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[["Reported so far", num(cur?.reported ?? 0)], ["This update", num(q)], ["Cumulative after", num(cum)], ["Remaining", num(remaining)]].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k}</dt><dd className={`text-sm font-extrabold tabular-nums ${over && k === "Cumulative after" ? "text-red-600" : "text-dark"}`}>{v} <span className="text-[11px] font-semibold text-slate-400">{unit}</span></dd></div>
                  ))}
                </dl>
                <button type="button" onClick={() => setQty(String(Math.max(0, Math.round((total - (cur?.reported ?? 0)) * 1000) / 1000)))} className={`mt-3 ${chip(false)} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30`}>Fill remaining ({num(Math.max(0, total - (cur?.reported ?? 0)))} {unit})</button>
              </div>
            ) : <p className="text-xs text-slate-500">Lump-sum subcontract: enter the quantity or percentage unit agreed with the project team.</p>}
            {over && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>This would exceed the subcontract quantity ({num(total)} {unit}). Check the figure before submitting.</span></p>
            )}
          </Section>

          <Section n={3} icon={Hammer} title="Site resources" hint="Who and what was on site: manpower, equipment and materials.">
            <div className="space-y-5">
              <div><h4 className={subLabel}>Manpower by trade</h4>
                <RowsEditor addLabel="Add trade" presets={MP_PRESETS} onRowsChange={setMp} totals={[{ name: "mp_count", label: "Headcount" }, { name: "mp_hours", label: "Man-hours" }]}
                  cols={[{ name: "mp_trade", label: "Trade", width: "2", placeholder: "e.g. Pipe fitter" }, { name: "mp_count", label: "Headcount", type: "number", placeholder: "0" }, { name: "mp_hours", label: "Total hours", type: "number", placeholder: "0" }]}
                  initial={prefill?.manpower.map((m) => ({ mp_trade: m.trade, mp_count: String(m.headcount), mp_hours: String(m.hours) }))} /></div>
              <div><h4 className={subLabel}>Equipment</h4>
                <RowsEditor addLabel="Add equipment" presets={EQ_PRESETS} onRowsChange={setEq}
                  cols={[{ name: "eq_name", label: "Equipment", width: "2", placeholder: "e.g. Excavator" }, { name: "eq_qty", label: "Qty", type: "number", placeholder: "1" }]}
                  initial={prefill?.equipment ? [{ eq_name: prefill.equipment, eq_qty: "" }] : undefined} /></div>
              <div><h4 className={subLabel}>Materials used</h4>
                <RowsEditor addLabel="Add material" presets={MAT_PRESETS}
                  cols={[{ name: "mat_name", label: "Material", width: "2", placeholder: "e.g. Sand" }, { name: "mat_unit", label: "Unit", placeholder: "m³" }, { name: "mat_qty", label: "Qty", type: "number", placeholder: "0" }]}
                  initial={prefill?.materials.map((m) => ({ mat_name: m.material, mat_unit: m.unit ?? "", mat_qty: String(m.quantity) }))} /></div>
            </div>
            <div>
              <div className={subLabel} id="weather-l">Weather</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="weather-l">
                {WEATHER.map(({ v, Icon }) => (
                  <label key={v} className={chip(weather === v)}>
                    <input type="radio" name="weather" value={v} checked={weather === v} onChange={() => {}} onClick={() => setWeather(weather === v ? "" : v)} className="sr-only" />
                    <Icon size={14} aria-hidden />{v}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Tap a selected option again to clear it.</p>
            </div>
          </Section>

          <Section n={4} icon={ClipboardList} title="Work done & photos" hint="Describe what was achieved and add site photos as evidence.">
            <div>
              <label htmlFor="work" className={subLabel}>Work done</label>
              <Textarea id="work" name="work_done" rows={4} maxLength={1000} value={work} onChange={(e) => setWork(e.target.value)} placeholder="e.g. Laid 120 m of 110 mm HDPE duct between MH-14 and MH-16, backfilled and compacted." />
              <div className="mt-1 text-right text-[11px] tabular-nums text-slate-400">{work.length} / 1000</div>
            </div>
            <div>
              <div className={subLabel}>Photos {photos.length > 0 && <span className="ml-1 rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary">{photos.length}</span>}</div>
              <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("label,button,input")) gallery.current?.click(); }}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${drag ? "border-primary bg-primary-50" : "border-slate-300 bg-slate-50/60 hover:border-primary/60"}`}>
                <ImagePlus size={26} className="text-primary" aria-hidden />
                <p className="text-sm font-semibold text-slate-600">Drag photos here, or use a button below</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border-[1.5px] border-primary bg-white px-3 py-2 text-sm font-bold text-primary hover:bg-primary-50 focus-within:ring-4 focus-within:ring-primary/20"><Camera size={15} />Take photo
                    <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid="photo-camera" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border-[1.5px] border-primary bg-white px-3 py-2 text-sm font-bold text-primary hover:bg-primary-50 focus-within:ring-4 focus-within:ring-primary/20"><ImagePlus size={15} />Choose from gallery
                    <input ref={gallery} type="file" accept="image/*" multiple className="sr-only" data-testid="photo-gallery" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></label>
                </div>
                <p className="text-xs text-slate-400">Images only, maximum 15 MB each.</p>
              </div>
              {photoMsg && <p className="mt-2 text-xs font-semibold text-red-600" aria-live="polite">{photoMsg}</p>}
              {photos.length > 0 && (
                <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {photos.map((p) => (
                    <li key={p.id} className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.file.name} className="h-full w-full object-cover" />
                      <button type="button" aria-label={`Remove ${p.file.name}`} onClick={() => removePhoto(p)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"><X size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section n={5} icon={AlertTriangle} title="Issues & delays" hint="Tell the project team about anything that blocked or slowed the work.">
            <div>
              <div className={subLabel} id="iss-l">Any issues or delays?</div>
              <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-labelledby="iss-l">
                {[[false, "No"], [true, "Yes"]].map(([v, t]) => (
                  <button key={String(t)} type="button" aria-pressed={hasIssues === v} onClick={() => { setHasIssues(v as boolean); if (!v) setRaise(false); }}
                    className={`rounded-lg px-5 py-1.5 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${hasIssues === v ? (v ? "bg-white text-amber-600 shadow-sm" : "bg-white text-primary shadow-sm") : "text-slate-500 hover:text-dark"}`}>{String(t)}</button>
                ))}
              </div>
            </div>
            <div className={hasIssues ? "space-y-3" : "hidden"}>
              <Field label="Issues encountered"><Textarea name="issues" rows={3} defaultValue={prefill?.issues ?? ""} placeholder="e.g. Utility clash at chainage 1+240, waiting for the DEWA drawing." /></Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Delay days"><Input type="number" name="delay_days" min="0" step="any" defaultValue={prefill?.delay_days ?? 0} /></Field>
                <Field label="Delay responsibility"><Select name="delay_responsibility" defaultValue={prefill?.delay_responsibility ?? "none"} options={responsibilities} /></Field>
                <Field label="Delay cause"><Input name="delay_cause" defaultValue={prefill?.delay_cause ?? ""} /></Field>
              </div>
              {!prefill && <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" name="raise_issue" checked={raise} onChange={(e) => setRaise(e.target.checked)} className="h-4 w-4 accent-primary" />Also raise the issue above as a tracked issue for the project team</label>}
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-20" aria-label="Report summary">
          <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
            <div className="bg-gradient-to-br from-primary to-primary-dark px-5 py-4 text-white">
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/70">{prefill ? "Corrected report" : "Report summary"}</div>
              <div className="mt-0.5 truncate text-base font-extrabold">{cur?.code ?? cur?.label ?? "No subcontract"}</div>
              <div className="truncate text-xs text-white/80">{cur?.projectCode}{cur?.projectName ? ` · ${cur.projectName}` : ""}</div>
            </div>
            <dl className="space-y-2.5 px-5 py-4 text-sm">
              {[
                ["Report date", dateLabel(date)],
                ["Quantity", `${num(q)} ${unit}`.trim()],
                ...(total ? [["Cumulative", `${num(Math.min(999, (cum / total) * 100), 1)}%`]] : []),
                ["Crew", `${num(crew.heads, 0)} people · ${num(crew.hours, 1)} h`],
                ["Equipment", `${eqCount} item${eqCount === 1 ? "" : "s"}`],
                ["Photos", String(photos.length)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className={`text-right font-bold tabular-nums ${k === "Cumulative" && over ? "text-red-600" : "text-dark"}`}>{v}</dd></div>
              ))}
            </dl>
            <ul className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
              {checks.map((c) => (
                <li key={c.text} className={`flex items-center gap-2 ${c.ok ? "text-dark" : "text-slate-400"}`}>
                  {c.ok ? <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-success text-white"><Check size={11} strokeWidth={3} /></span> : <Circle size={18} className="text-slate-300" />}{c.text}
                </li>
              ))}
            </ul>
            <div className="hidden space-y-2 border-t border-line px-5 py-4 lg:block">
              {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{state.error}</p>}
              {submitBtn("w-full")}
              {cancelHref && <Link href={cancelHref} className="block text-center text-xs font-bold text-slate-500 hover:text-primary">Cancel</Link>}
            </div>
          </div>
          <p className="mt-2 hidden px-1 text-[11px] text-slate-400 lg:block"><Layers size={11} className="mr-1 inline" />Reports are verified by the project team before they count towards progress.</p>
        </aside>
      </div>

      {/* Phone: sticky bottom bar (the desktop summary card holds the button from lg) */}
      <div className="fixed inset-x-0 bottom-[52px] z-[1100] border-t md:bottom-0 border-line bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        {state?.error && <p role="alert" className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{state.error}</p>}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs"><div className="truncate font-extrabold tabular-nums text-dark">{num(q)} {unit}</div><div className={`truncate ${over ? "font-bold text-red-600" : "text-slate-500"}`}>{total ? `${num(Math.min(999, (cum / total) * 100), 1)}% cumulative` : cur?.code}</div></div>
          {cancelHref && <Link href={cancelHref} className="text-xs font-bold text-slate-500">Cancel</Link>}
          {submitBtn("shrink-0")}
        </div>
      </div>
    </form>
  );
}

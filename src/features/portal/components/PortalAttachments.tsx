"use client";
import { Camera, Check, ClipboardList, FileText, Package, Paperclip, ReceiptText, Ruler, Timer, Upload, X, type LucideIcon } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { INVOICE_ATTACHMENT_CATEGORIES } from "@/lib/status";

export interface AttachState { tax: boolean; measurement: boolean; count: number }
const MAX = 15 * 1024 * 1024;
const META: Record<string, { Icon: LucideIcon; tag: "Required" | "Recommended" | "Optional"; hint: string }> = {
  tax_invoice: { Icon: ReceiptText, tag: "Required", hint: "Signed copy of your tax invoice" },
  measurement_sheet: { Icon: Ruler, tag: "Recommended", hint: "Quantities measured on site" },
  progress_photos: { Icon: Camera, tag: "Optional", hint: "Photos or a PDF of the work" },
  timesheet: { Icon: Timer, tag: "Optional", hint: "Crew hours for the period" },
  delivery_note: { Icon: Package, tag: "Optional", hint: "Material delivery notes" },
  other: { Icon: ClipboardList, tag: "Optional", hint: "Anything else supporting the claim" },
};
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const TAG: Record<string, string> = { Required: "bg-red-50 text-red-700", Recommended: "bg-amber-50 text-amber-700", Optional: "bg-slate-100 text-slate-500" };

/** One dropzone card per category; each posts att_category + att_file in order (tax invoice first) as the server's parallel fields expect. Empty inputs are ignored server-side. */
export default function PortalAttachments({ onChange }: { onChange?: (s: AttachState) => void }) {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState("");
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const apply = (cat: string, f: File | null) => {
    const el = refs.current[cat];
    const bad = f && f.size > MAX ? `${f.name} is larger than 15 MB` : "";
    if (el && f && !bad && el.files?.[0] !== f) { const dt = new DataTransfer(); dt.items.add(f); el.files = dt.files; }
    if (bad && el) el.value = "";
    const next = { ...files, [cat]: bad ? null : f };
    setFiles(next); setErrs((e) => ({ ...e, [cat]: bad }));
    onChange?.({ tax: !!next.tax_invoice, measurement: !!next.measurement_sheet, count: Object.values(next).filter(Boolean).length });
  };
  const remove = (cat: string) => { const el = refs.current[cat]; if (el) el.value = ""; apply(cat, null); };
  const onDrop = (cat: string, e: DragEvent) => { e.preventDefault(); setDrag(""); apply(cat, e.dataTransfer.files[0] ?? null); };
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {INVOICE_ATTACHMENT_CATEGORIES.map((c) => {
        const m = META[c.value] ?? META.other;
        const f = files[c.value];
        const id = `att-${c.value}`;
        return (
          <div key={c.value} data-attachment-row className={`rounded-xl border-[1.5px] p-3 transition ${f ? "border-primary/50 bg-primary-50/40" : drag === c.value ? "border-primary bg-primary-50 border-dashed" : "border-dashed border-slate-300 bg-slate-50/60 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15"}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(c.value); }} onDragLeave={() => setDrag("")} onDrop={(e) => onDrop(c.value, e)}>
            <input type="hidden" name="att_category" value={c.value} />
            <input ref={(el) => { refs.current[c.value] = el; }} id={id} type="file" name="att_file" aria-label={`${c.label} file`} accept=".pdf,image/*,.xlsx,.xls,.csv,.doc,.docx" className="sr-only"
              onChange={(e) => apply(c.value, e.target.files?.[0] ?? null)} />
            <div className="flex items-start gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${f ? "bg-primary text-white" : "bg-white text-primary shadow-sm"}`}>{f ? <Check size={18} aria-hidden /> : <m.Icon size={18} aria-hidden />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5"><span className="text-sm font-extrabold text-dark">{c.value === "tax_invoice" ? "Tax invoice" : c.label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${TAG[m.tag]}`}>{m.tag}</span></div>
                {f ? (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><FileText size={13} className="shrink-0 text-primary" aria-hidden /><span className="min-w-0 truncate font-semibold">{f.name}</span><span className="shrink-0 tabular-nums text-slate-400">{size(f.size)}</span></div>
                ) : <p className="mt-0.5 text-xs text-slate-500">{m.hint}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-[1.5px] border-primary bg-white px-2.5 py-1.5 text-xs font-bold text-primary hover:bg-primary-50">
                    {f ? <Paperclip size={13} aria-hidden /> : <Upload size={13} aria-hidden />}{f ? "Replace" : "Choose file or drop here"}</label>
                  {f && <button type="button" onClick={() => remove(c.value)} aria-label={`Remove ${f.name}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><X size={13} />Remove</button>}
                </div>
                {errs[c.value] && <p className="mt-1.5 text-xs font-semibold text-red-600" role="alert">{errs[c.value]}</p>}
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-400 sm:col-span-2">PDF, images, Word or Excel files, maximum 15 MB each.</p>
    </div>
  );
}

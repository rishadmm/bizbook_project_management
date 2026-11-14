"use client";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { INVOICE_ATTACHMENT_CATEGORIES } from "@/lib/status";

const ctl = "block w-full rounded-lg border-[1.5px] border-[#e2e8f0] bg-white px-2.5 py-2 text-sm text-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";

/** Repeating (category, file) rows posting parallel fields att_category / att_file. The first row is the tax invoice copy when `requireTaxInvoice`. */
export default function AttachmentRows({ requireTaxInvoice, title = "Attachments" }: { requireTaxInvoice?: boolean; title?: string }) {
  const [rows, setRows] = useState<number[]>([0]);
  const [next, setNext] = useState(1);
  const defaults = ["tax_invoice", "measurement_sheet", "progress_photos", "timesheet", "delivery_note", "other"];
  return (
    <div>
      <div className="mb-1 text-xs font-bold text-slate-600">{title}{requireTaxInvoice && <span className="ml-1 font-normal text-slate-400">(a copy of your signed tax invoice is required)</span>}</div>
      <div className="space-y-2">
        {rows.map((k, idx) => (
          <div key={k} className="flex flex-wrap items-center gap-2" data-attachment-row>
            <select name="att_category" aria-label="Attachment category" defaultValue={defaults[Math.min(idx, defaults.length - 1)]} className={`${ctl} sm:!w-48`}>
              {INVOICE_ATTACHMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input type="file" name="att_file" aria-label="Attachment file" accept=".pdf,image/*,.xlsx,.xls,.csv,.doc,.docx" className={`${ctl} min-w-0 flex-1 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs`} />
            <button type="button" aria-label="Remove attachment" disabled={rows.length === 1} onClick={() => setRows(rows.filter((r) => r !== k))} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"><X size={16} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => { setRows([...rows, next]); setNext(next + 1); }} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary"><Plus size={13} />Add attachment</button>
    </div>
  );
}

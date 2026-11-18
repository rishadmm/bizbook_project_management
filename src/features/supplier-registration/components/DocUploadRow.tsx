"use client";
import { useRef } from "react";
import { useServerForm } from "@/components/useServerForm";
import { uploadRegDocument, type RegState } from "../actions";

const ctl = "block w-full rounded-lg border-[1.5px] border-[#e2e8f0] bg-white px-2.5 py-1.5 text-sm text-dark focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

/** One registration document: file + reference + issue / expiry date. Uploading again creates a new version; the older ones stay on file. */
export default function DocUploadRow({ code, needsExpiry, current, hasFile }: { code: string; needsExpiry: boolean; current: { ref_no: string | null; issue_date: string | null; expiry_date: string | null } | null; hasFile: boolean }) {
  const { state, pending, onSubmit } = useServerForm<RegState>(uploadRegDocument, undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} onSubmit={onSubmit} data-action-form="" data-testid={`doc-form-${code}`} className="mt-3 grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
      <input type="hidden" name="code" value={code} />
      <label className="block"><span className="mb-1 block text-[11px] font-bold text-slate-500">{hasFile ? "Upload a new version" : "File (PDF, image, Word, Excel)"}</span>
        <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx,.txt" data-testid={`doc-file-${code}`} className={`${ctl} file:mr-2 file:rounded-md file:border-0 file:bg-primary-50 file:px-2 file:py-1 file:text-xs file:font-bold file:text-primary`} /></label>
      <label className="block"><span className="mb-1 block text-[11px] font-bold text-slate-500">Reference no.</span><input name="ref_no" defaultValue={current?.ref_no ?? ""} placeholder="e.g. CN-1234567" className={ctl} /></label>
      <label className="block"><span className="mb-1 block text-[11px] font-bold text-slate-500">Issue date</span><input name="issue_date" type="date" defaultValue={current?.issue_date ?? ""} className={ctl} /></label>
      <label className="block"><span className="mb-1 block text-[11px] font-bold text-slate-500">Expiry date{needsExpiry ? " *" : ""}</span><input name="expiry_date" type="date" defaultValue={current?.expiry_date ?? ""} data-testid={`doc-expiry-${code}`} className={ctl} /></label>
      <button type="submit" disabled={pending} data-testid={`doc-save-${code}`} className="h-9 rounded-lg bg-primary px-4 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-60">{pending ? "Saving…" : hasFile ? "Save" : "Upload"}</button>
      {state && !state.ok && <p role="alert" className="text-xs font-semibold text-red-600 sm:col-span-2 xl:col-span-5">{state.error}</p>}
      {state?.ok && <p role="status" className="text-xs font-semibold text-emerald-700 sm:col-span-2 xl:col-span-5">Saved.</p>}
    </form>
  );
}

"use client";
import { ChevronLeft, ChevronRight, Download, File as FileIcon, FileImage, FileText, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { uploadAttachments } from "@/components/attachments-actions";
import { INVOICE_ATTACHMENT_CATEGORIES } from "@/lib/status";

export interface AttachmentView { id: number; filename: string; category: string | null; mime: string | null; size: number | null; uploader: string | null; date: string; note: string | null }

const sizeLabel = (n: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isPdf = (a: AttachmentView) => a.mime === "application/pdf";
const isImg = (a: AttachmentView) => !!a.mime?.startsWith("image/");
const previewable = (a: AttachmentView) => isPdf(a) || isImg(a);
const ctl = "block w-full rounded-lg border-[1.5px] border-[#e2e8f0] bg-white px-2.5 py-1.5 text-sm text-dark focus:border-primary focus:outline-none";

function Icon({ a }: { a: AttachmentView }) {
  const C = isImg(a) ? FileImage : isPdf(a) ? FileText : FileIcon;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary"><C size={17} /></span>;
}

/** Attachments of the invoice grouped by category, with an in-page viewer (PDF in an iframe, images in a lightbox with prev/next) and upload. */
export default function AttachmentsCard({ invoiceId, items, canUpload }: { invoiceId: number; items: AttachmentView[]; canUpload: boolean }) {
  const [open, setOpen] = useState<number | null>(null); // index in `view`
  const groups = INVOICE_ATTACHMENT_CATEGORIES.map((c) => ({ ...c, rows: items.filter((a) => (a.category ?? "other") === c.value) })).filter((g) => g.rows.length);
  const known = new Set(INVOICE_ATTACHMENT_CATEGORIES.map((c) => c.value));
  const rest = items.filter((a) => a.category && !known.has(a.category));
  if (rest.length) groups.push({ value: "other", label: "Other", rows: rest });
  const view = groups.flatMap((g) => g.rows).filter(previewable); // same order as the card
  const cur = open === null ? null : view[open];
  const ref = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (open === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((o) => (o === null ? o : (o + 1) % view.length));
      if (e.key === "ArrowLeft") setOpen((o) => (o === null ? o : (o - 1 + view.length) % view.length));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, view.length]);
  return (
    <Card className="p-0" >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div><h3 className="text-sm font-extrabold tracking-tight text-dark">Attachments</h3><p className="text-xs text-slate-500">{items.length} file{items.length === 1 ? "" : "s"}</p></div>
      </div>
      <div className="space-y-4 p-5">
        {groups.length === 0 && <p className="text-sm text-slate-500">No attachments yet.</p>}
        {groups.map((g) => (
          <div key={g.value + g.label}>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">{g.label} <span className="font-semibold text-slate-400">({g.rows.length})</span></div>
            <ul className="space-y-1.5">
              {g.rows.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5" data-attachment={a.id}>
                  <Icon a={a} />
                  <div className="min-w-0 flex-1">
                    {previewable(a)
                      ? <button type="button" onClick={() => setOpen(view.findIndex((v) => v.id === a.id))} className="block max-w-full truncate text-left text-sm font-semibold text-primary-dark hover:underline" title={a.filename}>{a.filename}</button>
                      : <a href={`/api/files/${a.id}?download=1`} className="block max-w-full truncate text-sm font-semibold text-primary-dark hover:underline" title={a.filename}>{a.filename}</a>}
                    <div className="truncate text-[11px] text-slate-500">{[sizeLabel(a.size), a.uploader ?? "Subcontractor portal", a.date].filter(Boolean).join(" · ")}</div>
                  </div>
                  <a href={`/api/files/${a.id}?download=1`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100" title="Download" aria-label={`Download ${a.filename}`}><Download size={15} /></a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {canUpload && (
          <form ref={ref} className="space-y-2 rounded-xl bg-[#f8fafc] p-3" action={async (fd) => {
            setPending(true); setErr("");
            try { fd.set("entityType", "sub_invoice"); fd.set("entityId", String(invoiceId)); fd.set("revalidate", `/invoices/${invoiceId}`); await uploadAttachments(fd); ref.current?.reset(); }
            catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
            setPending(false);
          }}>
            <div className="text-xs font-bold text-slate-600">Upload</div>
            <select name="category" aria-label="Category" defaultValue="other" className={ctl}>{INVOICE_ATTACHMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            <input type="file" name="files" multiple required aria-label="Files" className={`${ctl} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs`} />
            {err && <p role="alert" className="text-xs font-medium text-red-600">{err}</p>}
            <Button type="submit" variant="primary" size="sm" disabled={pending}><Upload size={13} />{pending ? "Uploading…" : "Upload"}</Button>
          </form>
        )}
      </div>

      {cur && (
        <div role="dialog" aria-modal="true" aria-label={`Preview ${cur.filename}`} className="fixed inset-0 z-[3000] flex flex-col bg-slate-900/80" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="flex items-center gap-3 px-4 py-3 text-white">
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{cur.filename}</div><div className="text-xs text-white/60">{open! + 1} / {view.length}</div></div>
            <a href={`/api/files/${cur.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20">Open in new tab</a>
            <a href={`/api/files/${cur.id}?download=1`} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20"><Download size={14} />Download</a>
            <button type="button" aria-label="Close preview" onClick={() => setOpen(null)} className="rounded-lg p-1.5 hover:bg-white/10"><X size={20} /></button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
            {isPdf(cur)
              ? <div className="relative h-full w-full max-w-5xl rounded-lg bg-white">
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-500"><span>Preview not available in this browser.</span><span><a className="font-bold text-primary" href={`/api/files/${cur.id}`} target="_blank" rel="noreferrer">Open in new tab</a> · <a className="font-bold text-primary" href={`/api/files/${cur.id}?download=1`}>Download</a></span></div>
                <iframe key={cur.id} title={cur.filename} src={`/api/files/${cur.id}`} className="relative h-full w-full rounded-lg bg-white" />
              </div>
              // eslint-disable-next-line @next/next/no-img-element
              : <img key={cur.id} src={`/api/files/${cur.id}`} alt={cur.filename} className="max-h-full max-w-full rounded-lg bg-white object-contain shadow-2xl" />}
            {view.length > 1 && (
              <>
                <button type="button" aria-label="Previous file" onClick={() => setOpen((open! - 1 + view.length) % view.length)} className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30"><ChevronLeft size={22} /></button>
                <button type="button" aria-label="Next file" onClick={() => setOpen((open! + 1) % view.length)} className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white hover:bg-white/30"><ChevronRight size={22} /></button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

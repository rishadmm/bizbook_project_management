"use client";
import { Braces, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/lib/status";

const TONE: Record<string, Tone> = { not_synced: "slate", queued: "amber", synced: "green", failed: "red" };
const LABEL: Record<string, string> = { not_synced: "Not synced", queued: "Queued", synced: "Synced", failed: "Failed" };

/** ERP card: sync status pill, ERP document number, JSON preview of the AP invoice payload and a disabled "Send to ERP" button. */
export default function ErpCard({ invoiceId, status, docNo, syncedAt, error }: { invoiceId: number; status: string; docNo: string | null; syncedAt: string | null; error: string | null }) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  async function show() {
    setOpen(true); setBusy(true); setJson("");
    try {
      const r = await fetch(`/api/erp/invoices/${invoiceId}`, { cache: "no-store" });
      setJson(r.ok ? JSON.stringify(await r.json(), null, 2) : `Could not load the payload (${r.status}).`);
    } catch { setJson("Could not load the payload."); }
    setBusy(false);
  }
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between"><h3 className="text-sm font-extrabold tracking-tight text-dark">ERP</h3><Badge tone={TONE[status] ?? "slate"}>{LABEL[status] ?? status}</Badge></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-slate-400">ERP document</dt><dd className="font-semibold text-slate-700">{docNo ?? "—"}</dd></div>
        <div><dt className="text-slate-400">Last sync</dt><dd className="font-semibold text-slate-700">{syncedAt ?? "—"}</dd></div>
      </dl>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={show}><Braces size={13} />Preview ERP payload</Button>
        <span title="ERP connection not configured"><Button size="sm" variant="primary" disabled><Send size={13} />Send to ERP</Button></span>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="ERP payload (bizbook.ap_invoice.v1)" wide>
        <pre className="max-h-[60vh] overflow-auto rounded-lg bg-slate-900 p-4 text-[11px] leading-5 text-slate-100" data-testid="erp-json">{busy ? "Loading…" : json}</pre>
      </Modal>
    </Card>
  );
}

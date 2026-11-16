"use client";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Input, Card } from "@/components/ui";
import { buttonClass } from "@/components/ui/Button";
import ActionForm from "@/components/ActionForm";
import { saveClientPortalSettings } from "../actions";

/** Portal URL with Copy / Open, editable slug, Enable / Disable switch and the two visibility switches. */
export default function ClientUrlCard({ clientId, origin, slug, enabled, showSubs, showFin, canManage }: {
  clientId: number; origin: string; slug: string; enabled: boolean; showSubs: boolean; showFin: boolean; canManage: boolean;
}) {
  const [done, setDone] = useState(false);
  const url = `${origin}/c/${slug}`;
  async function copy() {
    try { await navigator.clipboard.writeText(url); } catch {
      const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1800);
  }
  const Switch = ({ flag, label, on, hint }: { flag: "subcontractors" | "financials"; label: string; on: boolean; hint: string }) => (
    <ActionForm action={saveClientPortalSettings} className="flex items-center gap-2">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="visibility" value={flag} /><input type="hidden" name="value" value={on ? "0" : "1"} />
      <Button type="submit" size="sm" variant={on ? "secondary" : "ghost"} data-testid={`switch-${flag}`} aria-pressed={on}>{label}: {on ? "On" : "Off"}</Button>
      <span className="text-xs text-slate-500">{hint}</span>
    </ActionForm>
  );
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted">Client portal URL <Badge tone={enabled ? "green" : "slate"}>{enabled ? "Enabled" : "Disabled"}</Badge></div>
          <div data-testid="portal-url" className="break-all font-mono text-sm font-bold text-dark">{url}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copy} className={buttonClass("secondary", "sm")}>{done ? <Check size={13} /> : <Copy size={13} />}{done ? "Copied" : "Copy"}</button>
          <a href={url} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}><ExternalLink size={13} />Open</a>
        </div>
      </div>
      {canManage && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <ActionForm action={saveClientPortalSettings} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="client_id" value={clientId} />
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Portal address</span>
                <span className="flex items-center gap-1.5"><span className="text-sm text-slate-500">/c/</span><Input name="slug" defaultValue={slug} className="!w-52 font-mono" aria-label="Portal address" /></span></label>
              <Button type="submit" size="sm">Save address</Button>
            </ActionForm>
            <ActionForm action={saveClientPortalSettings} className="flex items-center gap-2">
              <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="enable" value={enabled ? "0" : "1"} />
              <Button type="submit" size="sm" variant={enabled ? "danger" : "success"} data-testid="portal-toggle">{enabled ? "Disable portal" : "Enable portal"}</Button>
              <span className="text-xs text-slate-500">{enabled ? "Disabling signs everyone out and refuses new sign-ins." : "Users can sign in once the portal is enabled."}</span>
            </ActionForm>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2" data-testid="visibility-switches">
            <Switch flag="subcontractors" label="Show subcontractor names" on={showSubs} hint={showSubs ? "Crew names are visible to the client." : "Shown as Contractor crew A, B, ..."} />
            <Switch flag="financials" label="Show financials" on={showFin} hint={showFin ? "Contract value and value of work done are visible." : "Contract values are hidden everywhere."} />
          </div>
        </div>
      )}
    </Card>
  );
}

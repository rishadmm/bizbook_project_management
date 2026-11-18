"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { switchEntity } from "@/features/entities/actions";

/** Info bar on a detail page whose record belongs to another country than the active one (the user has access to both). */
export default function EntityBar({ what, entityCode, entityName, activeName }: { what: string; entityCode: string; entityName: string; activeName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div role="status" data-testid="entity-bar" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-primary/20 bg-primary-50 px-4 py-2.5 text-sm text-primary">
      <Info size={16} className="shrink-0" />
      <span className="font-semibold">This {what} belongs to {entityName}. Amounts are shown in {entityName}&apos;s currency; your active country is {activeName}.</span>
      <button type="button" disabled={pending} onClick={() => start(async () => { const r = await switchEntity(entityCode); if (!r.ok) setErr(r.error); else router.refresh(); })}
        className="ml-auto rounded-full bg-primary px-3 py-1 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60">Switch to {entityName}</button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}

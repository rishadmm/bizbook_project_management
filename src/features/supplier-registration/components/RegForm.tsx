"use client";
import Link from "next/link";
import { useServerForm } from "@/components/useServerForm";
import type { RegState } from "../actions";

/** Form of one wizard step: keeps what was typed when the server answers with a validation message; success redirects to the next step. */
export default function RegForm({ action, submitLabel = "Save and continue", backHref, children, testId, danger, disabled }: {
  action: (prev: RegState, form: FormData) => Promise<RegState>; submitLabel?: string; backHref?: string; children: React.ReactNode; testId?: string; danger?: boolean; disabled?: boolean;
}) {
  const { state, pending, onSubmit } = useServerForm<RegState>(action, undefined);
  return (
    <form onSubmit={onSubmit} data-action-form="" data-testid={testId} className="space-y-5">
      {children}
      {state && !state.ok && <p role="alert" data-testid="reg-error" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {backHref && <Link href={backHref} className="inline-flex h-11 items-center rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-5 text-sm font-bold text-slate-700 hover:border-primary hover:text-primary">Back</Link>}
        <button type="submit" disabled={pending || disabled} data-testid="reg-submit" className={`ml-auto inline-flex h-11 items-center rounded-xl px-6 text-sm font-bold text-white shadow-brand-sm disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "bg-emerald-600 hover:bg-emerald-700" : "bg-primary hover:bg-primary-dark"}`}>{pending ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}

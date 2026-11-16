"use client";
import { useActionState } from "react";
import { clientForcedPasswordChange, type ClientFormState } from "@/features/client-portal/auth-actions";

const input = "block h-[52px] w-full rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-4 text-[15px] text-dark focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";
const label = "mb-1.5 block text-sm font-bold text-slate-700";

export default function ForcedChangeForm() {
  const [state, action, pending] = useActionState<ClientFormState, FormData>(clientForcedPasswordChange, undefined);
  return (
    <form action={action} data-readonly-ok="password" className="space-y-5">
      <div><label className={label} htmlFor="current">Temporary password</label><input id="current" name="current" type="password" required autoComplete="current-password" className={input} /></div>
      <div><label className={label} htmlFor="next">New password</label><input id="next" name="next" type="password" required autoComplete="new-password" className={input} /><p className="mt-1 text-xs text-muted">At least 8 characters with an uppercase letter, a lowercase letter and a digit.</p></div>
      <div><label className={label} htmlFor="confirm">Confirm new password</label><input id="confirm" name="confirm" type="password" required autoComplete="new-password" className={input} /></div>
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-[52px] w-full rounded-xl bg-primary text-base font-bold text-white shadow-brand hover:bg-primary-dark disabled:opacity-60">{pending ? "Saving…" : "Save password and continue →"}</button>
    </form>
  );
}

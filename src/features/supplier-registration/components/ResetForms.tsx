"use client";
import Link from "next/link";
import { useServerForm } from "@/components/useServerForm";
import { requestPasswordReset, resetPassword, type PubState } from "../public-actions";
import { bigInput, Honeypot, PField, PasswordInput } from "./PublicInputs";

export function ForgotForm() {
  const { state, pending, onSubmit } = useServerForm<PubState>(requestPasswordReset, undefined);
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-5">
      <Honeypot />
      <PField label="Email" hint="We send a one-time reset link to the email you registered with."><input name="email" type="email" required autoFocus autoComplete="username" placeholder="you@company.com" className={bigInput} /></PField>
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      {state?.info && <p role="status" data-testid="reset-sent" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{state.info}</p>}
      <button type="submit" disabled={pending} className="h-[52px] w-full rounded-xl bg-primary text-base font-bold text-white shadow-brand transition hover:bg-primary-dark disabled:opacity-60">{pending ? "Sending…" : "Send reset link"}</button>
      <Link href="/suppliers/login" className="block text-center text-sm font-bold text-primary hover:underline">Back to sign in</Link>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const { state, pending, onSubmit } = useServerForm<PubState>(resetPassword, undefined);
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <PField label="New password" hint="8+ characters with upper case, lower case and a digit."><PasswordInput name="password" autoComplete="new-password" placeholder="Choose a new password" /></PField>
      <PField label="Confirm password"><PasswordInput name="confirm" autoComplete="new-password" placeholder="Repeat the password" /></PField>
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      {state?.info ? (
        <div className="space-y-3"><p role="status" data-testid="reset-done" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{state.info}</p><Link href="/suppliers/login" className="flex h-[52px] items-center justify-center rounded-xl bg-primary text-base font-bold text-white shadow-brand hover:bg-primary-dark">Go to sign in</Link></div>
      ) : (
        <button type="submit" disabled={pending} className="h-[52px] w-full rounded-xl bg-primary text-base font-bold text-white shadow-brand transition hover:bg-primary-dark disabled:opacity-60">{pending ? "Saving…" : "Set new password"}</button>
      )}
    </form>
  );
}

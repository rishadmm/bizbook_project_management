"use client";
import Link from "next/link";
import { useServerForm } from "@/components/useServerForm";
import { registerSupplier, type PubState } from "../public-actions";
import { bigInput, Honeypot, PField, PasswordInput } from "./PublicInputs";

export default function RegisterForm({ countries, initial }: { countries: { code: string; flag: string | null; country: string; legal: string }[]; initial: string }) {
  const { state, pending, onSubmit } = useServerForm<PubState>(registerSupplier, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-5" noValidate>
      <Honeypot />
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-700">Country of registration</legend>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {countries.map((c) => (
            <label key={c.code} className="flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-[#e2e8f0] bg-white p-3 transition has-[:checked]:border-primary has-[:checked]:bg-primary-50 has-[:checked]:ring-4 has-[:checked]:ring-primary/10">
              <input type="radio" name="country" value={c.code} defaultChecked={c.code === initial} className="h-4 w-4 accent-[#635bff]" data-testid={`reg-country-${c.code}`} />
              <span className="text-2xl leading-none" aria-hidden>{c.flag}</span>
              <span className="min-w-0"><span className="block truncate text-sm font-extrabold text-dark">{c.country}</span><span className="block truncate text-xs text-slate-500">{c.legal}</span></span>
            </label>
          ))}
        </div>
        {fe.country && <span role="alert" className="mt-1 block text-xs font-semibold text-red-600">{fe.country}</span>}
      </fieldset>
      <PField label="Company legal name" error={fe.company}><input name="company" required autoComplete="organization" placeholder="e.g. Al Batinah Fibre Works LLC" className={bigInput} /></PField>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <PField label="Primary contact's full name" error={fe.contact_name}><input name="contact_name" required autoComplete="name" placeholder="Full name" className={bigInput} /></PField>
        <PField label="Mobile number" error={fe.phone}><input name="phone" required type="tel" autoComplete="tel" placeholder="+971 5x xxx xxxx" className={bigInput} /></PField>
      </div>
      <PField label="Work email" error={fe.email} hint="This is also your sign-in name."><input name="email" type="email" required autoComplete="username" placeholder="you@company.com" className={bigInput} /></PField>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <PField label="Password" error={fe.password} hint="8+ characters with upper case, lower case and a digit."><PasswordInput name="password" autoComplete="new-password" placeholder="Choose a password" /></PField>
        <PField label="Confirm password" error={fe.confirm}><PasswordInput name="confirm" autoComplete="new-password" placeholder="Repeat the password" /></PField>
      </div>
      <div>
        <label className="flex items-start gap-2.5 text-sm font-semibold text-slate-700"><input type="checkbox" name="terms" className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#635bff]" />
          <span>I accept the supplier registration terms and confirm that I am authorised to register this company.</span></label>
        {fe.terms && <span role="alert" className="mt-1 block text-xs font-semibold text-red-600">{fe.terms}</span>}
      </div>
      {state?.error && !Object.keys(fe).length && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      {state?.error && Object.keys(fe).length > 0 && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-[52px] w-full rounded-xl bg-primary text-base font-bold text-white shadow-brand transition hover:bg-primary-dark disabled:opacity-60">{pending ? "Creating your account…" : "Create account and continue →"}</button>
      <p className="text-center text-sm text-slate-500">Already registered? <Link href="/suppliers/login" className="font-bold text-primary hover:underline">Sign in</Link></p>
    </form>
  );
}

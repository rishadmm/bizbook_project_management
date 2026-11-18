"use client";
import Link from "next/link";
import { useState } from "react";
import { useServerForm } from "@/components/useServerForm";
import { supplierSignIn, type PubState } from "../public-actions";
import { bigInput, PField, PasswordInput } from "./PublicInputs";

export default function SupplierLoginForm() {
  const { state, pending, onSubmit } = useServerForm<PubState>(supplierSignIn, undefined);
  const [chosen, setChosen] = useState("");
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-5">
      <PField label="Email"><input name="email" type="email" required autoFocus autoComplete="username" placeholder="you@company.com" className={bigInput} /></PField>
      <div>
        <div className="mb-1.5 flex items-center justify-between"><span className="text-sm font-bold text-slate-700">Password</span><Link href="/suppliers/login?forgot=1" className="text-sm font-bold text-primary hover:underline">Forgot password?</Link></div>
        <PasswordInput name="password" autoComplete="current-password" placeholder="Enter your password" />
      </div>
      {state?.choices && (
        <fieldset className="rounded-xl border border-line bg-[#f8fafc] p-3" data-testid="supplier-chooser">
          <legend className="px-1 text-sm font-bold text-slate-700">This email belongs to more than one company or country. Which one?</legend>
          <div className="mt-1 space-y-2">
            {state.choices.map((c) => (
              <label key={c.slug} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-white p-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-50">
                <input type="radio" name="slug" value={c.slug} required checked={chosen === c.slug} onChange={() => setChosen(c.slug)} className="accent-[#635bff]" />
                <span aria-hidden className="text-xl">{c.flag}</span><span className="text-sm font-bold text-dark">{c.name}</span><span className="ml-auto text-xs text-slate-500">{c.country}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700"><input type="checkbox" name="remember" className="h-4 w-4 rounded border-slate-300 accent-[#635bff]" /> Remember me for 30 days</label>
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-[52px] w-full rounded-xl bg-primary text-base font-bold text-white shadow-brand transition hover:bg-primary-dark disabled:opacity-60">{pending ? "Signing in…" : state?.choices ? "Continue →" : "Sign in →"}</button>
      <p className="text-center text-sm text-slate-500">New supplier? <Link href="/suppliers/register" className="font-bold text-primary hover:underline">Register your company</Link></p>
    </form>
  );
}

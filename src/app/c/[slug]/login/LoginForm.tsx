"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { clientSignIn, type ClientFormState } from "@/features/client-portal/auth-actions";

const input = "block h-[52px] w-full rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-4 text-[15px] text-dark placeholder:text-[#94a3b8] transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

export default function ClientLoginForm({ slug, next }: { slug: string; next: string }) {
  const [state, action, pending] = useActionState<ClientFormState, FormData>(clientSignIn, undefined);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="slug" value={slug} /><input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-bold text-slate-700">Email</label>
        <input id="email" name="email" type="email" required autoFocus autoComplete="username" placeholder="you@company.com" className={input} />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-bold text-slate-700">Password</label>
          <Link href={`/c/${slug}/login?forgot=1`} className="text-sm font-bold text-primary hover:underline">Forgot password?</Link>
        </div>
        <div className="relative">
          <input id="password" name="password" type={show ? "text" : "password"} required autoComplete="current-password" placeholder="Enter your password" className={`${input} pr-12`} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:text-primary">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </div>
      </div>
      <div>
        <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700"><input type="checkbox" name="remember" className="h-4 w-4 rounded border-slate-300 accent-[#635bff]" /> Remember me for 30 days</label>
        <p className="ml-[26px] mt-1 text-xs text-muted">Leave unchecked to sign out when you close the browser.</p>
      </div>
      {state?.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-[52px] w-full rounded-xl bg-primary text-base font-bold text-white shadow-brand transition hover:bg-primary-dark disabled:opacity-60">{pending ? "Signing in…" : "Sign in →"}</button>
    </form>
  );
}

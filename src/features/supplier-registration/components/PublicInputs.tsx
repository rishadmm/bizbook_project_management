"use client";
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Big inputs of the public sign-in / registration screens (same look as the login pages). */
export const bigInput = "block h-[48px] w-full rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-4 text-[15px] text-dark placeholder:text-[#94a3b8] transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

export function PField({ label, error, hint, children, className }: { label: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-sm font-bold text-slate-700">{label}</span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs font-semibold text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function PasswordInput({ name, id, autoComplete, placeholder }: { name: string; id?: string; autoComplete: string; placeholder?: string } & Partial<InputHTMLAttributes<HTMLInputElement>>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id ?? name} name={name} type={show ? "text" : "password"} required autoComplete={autoComplete} placeholder={placeholder} className={`${bigInput} pr-12`} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:text-primary">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </div>
  );
}

/** Honeypot: invisible to people (off-screen, not focusable), irresistible to bots. A filled value makes the server refuse the form silently. */
export function Honeypot() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
      <label>Company website<input type="text" name="company_website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
    </div>
  );
}

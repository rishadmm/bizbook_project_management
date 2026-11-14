import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const control = "block rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-dark placeholder:text-[#94a3b8] transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:bg-slate-50";

/** Controls fill their container unless the caller passes its own `w-*` class. */
const ctl = (className?: string) => cn(control, !/(^|\s)w-/.test(className ?? "") && "w-full", className);

/** Label + control wrapper. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={ctl(className)} {...p} />;
}
export function Textarea({ className, rows = 4, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={ctl(className)} {...p} />;
}
/** <Select options={statusOptions("tenderStatus")} placeholder="All" /> or pass <option> children. */
export function Select({ options, placeholder, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options?: { value: string | number; label: string }[]; placeholder?: string }) {
  return (
    <select className={ctl(className)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      {children}
    </select>
  );
}

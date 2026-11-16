"use client";
import { Printer } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";

const field = "h-9 rounded-lg border-[1.5px] border-line bg-white px-2.5 text-sm font-semibold text-slate-700 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15";

/** Query-string driven filter controls. They are plain inputs (no <form>): the page stays read-only and every filter is a shareable URL. */
export function useSetParam() {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  return (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v); else q.delete(k);
    router.replace(`${path}${q.size ? `?${q}` : ""}`, { scroll: false });
  };
}
export function SelectParam({ name, label, value, options, all = "All" }: { name: string; label: string; value: string; options: { value: string; label: string }[]; all?: string }) {
  const set = useSetParam();
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-muted">{label}
      <select aria-label={label} value={value} onChange={(e) => set(name, e.target.value)} className={field}>
        <option value="">{all}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
export function DateParam({ name, label, value, max, type = "date" }: { name: string; label: string; value: string; max?: string; type?: "date" | "month" }) {
  const set = useSetParam();
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-muted">{label}
      <input type={type} aria-label={label} value={value} max={max} onChange={(e) => set(name, e.target.value)} className={field} />
    </label>
  );
}
export function PrintButton({ label = "Print / save as PDF" }: { label?: string }) {
  return <button type="button" onClick={() => window.print()} className={`no-print ${buttonClass("secondary")}`}><Printer size={15} />{label}</button>;
}

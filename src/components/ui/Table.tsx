import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "./cn";

/** Dense table primitives. Use <TD num> / <TH num> for right-aligned tabular numbers (money). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className="overflow-x-auto"><table className={cn("w-full text-sm", className)}>{children}</table></div>;
}
export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-[#f8fafc] text-left text-xs font-bold uppercase tracking-wide text-muted">{children}</thead>;
}
export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-[#f1f5f9]">{children}</tbody>;
}
export function TR({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-[#f8fafc]", className)} {...p} />;
}
export function TH({ num, className, ...p }: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <th className={cn("border-b border-line px-3 py-2.5 font-bold", num && "text-right", className)} {...p} />;
}
export function TD({ num, className, ...p }: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <td className={cn("px-3 py-2 align-middle text-slate-700", num && "text-right tabular-nums", className)} {...p} />;
}

import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "./cn";

/** Dense table primitives. Use <TD num> / <TH num> for right-aligned tabular numbers (money). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className="overflow-x-auto"><table className={cn("w-full text-sm", className)}>{children}</table></div>;
}
export function THead({ children }: { children: ReactNode }) {
  return <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</thead>;
}
export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}
export function TR({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-slate-50/70", className)} {...p} />;
}
export function TH({ num, className, ...p }: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <th className={cn("border-b border-slate-200 px-3 py-2 font-semibold", num && "text-right", className)} {...p} />;
}
export function TD({ num, className, ...p }: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <td className={cn("px-3 py-2 align-middle text-slate-700", num && "text-right tabular-nums", className)} {...p} />;
}

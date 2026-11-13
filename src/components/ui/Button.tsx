import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";
export type ButtonSize = "sm" | "md";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
    variant === "primary" && "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    variant === "success" && "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm",
    variant === "secondary" && "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
    variant === "danger" && "bg-white text-red-600 border border-red-300 hover:bg-red-50",
    variant === "ghost" && "text-slate-600 hover:bg-slate-100",
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: ButtonVariant; size?: ButtonSize }
/** <Button variant size> — plain button (works as form submit; pair with server actions via <form action>). */
export function Button({ variant, size, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/** <LinkButton href> — a next/link styled as a button. */
export function LinkButton({ href, variant, size, className, children }: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode }) {
  return <Link href={href} className={buttonClass(variant, size, className)}>{children}</Link>;
}

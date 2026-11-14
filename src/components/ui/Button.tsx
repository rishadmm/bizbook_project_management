import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";
export type ButtonSize = "sm" | "md";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string): string {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-[10px] font-bold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
    variant === "primary" && (size === "sm" ? "bg-primary text-white shadow-brand-sm hover:bg-primary-dark" : "bg-primary text-white shadow-brand hover:bg-primary-dark"),
    variant === "success" && "bg-success text-white hover:bg-green-600 shadow-sm",
    variant === "secondary" && "bg-white text-primary border-[1.5px] border-primary hover:bg-primary-50",
    variant === "danger" && "bg-white text-red-600 border-[1.5px] border-red-300 hover:bg-red-50",
    variant === "ghost" && "text-slate-600 hover:bg-primary-50 hover:text-primary",
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

"use client";
import type { ButtonHTMLAttributes } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";

/** Submit button that asks for confirmation before submitting its form. */
export default function ConfirmButton({ message, variant = "ghost", size = "sm", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { message: string; variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button type="submit" className={buttonClass(variant, size, className)} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }} {...rest}>{children}</button>
  );
}

"use client";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "./cn";

/** Table row that navigates to `href` when clicked (clicks on links, buttons, forms and inputs keep their own behaviour). */
export function ClickRow({ href, children, className, "data-testid": testId }: { href: string; children: ReactNode; className?: string; "data-testid"?: string }) {
  const router = useRouter();
  return (
    <tr
      data-testid={testId}
      className={cn("cursor-pointer hover:bg-[#f8fafc]", className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, form, input, select, textarea, label, [role=dialog], [data-no-row-click]")) return;
        if (window.getSelection()?.toString()) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}

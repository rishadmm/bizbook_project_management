"use client";
import { Check, Copy, Download, Printer } from "lucide-react";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button";

/** Download PDF / Print / Copy link buttons of the invoice page header. */
export default function HeaderTools({ id }: { id: number }) {
  const [done, setDone] = useState(false);
  return (
    <div className="no-print flex flex-wrap items-center gap-1.5">
      <a href={`/invoices/${id}/pdf?download=1`} className={buttonClass("secondary", "sm")}><Download size={13} />Download PDF</a>
      <button type="button" className={buttonClass("secondary", "sm")} onClick={() => window.print()}><Printer size={13} />Print</button>
      <button type="button" className={buttonClass("secondary", "sm")} onClick={async () => {
        const url = window.location.href;
        try { await navigator.clipboard.writeText(url); } catch {
          const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
        }
        setDone(true); setTimeout(() => setDone(false), 1800);
      }}>{done ? <Check size={13} /> : <Copy size={13} />}{done ? "Copied" : "Copy link"}</button>
    </div>
  );
}

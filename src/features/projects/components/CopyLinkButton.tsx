"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button";

/** Copies the absolute portal link `/portal/<token>` to the clipboard. */
export default function CopyLinkButton({ token, label = "Copy link" }: { token: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={buttonClass("secondary", "sm")} onClick={async () => {
      const url = `${window.location.origin}/portal/${token}`;
      try { await navigator.clipboard.writeText(url); } catch {
        const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
      }
      setDone(true); setTimeout(() => setDone(false), 1800);
    }}>
      {done ? <Check size={13} className="mr-1" /> : <Copy size={13} className="mr-1" />}{done ? "Copied" : label}
    </button>
  );
}

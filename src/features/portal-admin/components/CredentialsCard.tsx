"use client";
import { Check, Copy, KeyRound, Mail, Printer } from "lucide-react";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import type { IssuedCredentials } from "../types";

/** One-time credentials card: portal URL, e-mail and temporary password with copy / print. Rendered from the action response only (never persisted). */
export default function CredentialsCard({ cred, company, tenant, basePath = "/p", portalLabel = "Subcontractor Portal" }: { cred: IssuedCredentials; company: string; tenant: string; basePath?: string; portalLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? `${basePath}/${cred.slug}` : `${window.location.origin}${basePath}/${cred.slug}`;
  const message = [
    `${portalLabel} - ${company}`,
    `Hello ${cred.name}, your portal access for ${tenant} is ready.`,
    "",
    `Portal: ${url}`,
    `Email: ${cred.email}`,
    `Temporary password: ${cred.password}`,
    "",
    "You will be asked to choose a new password the first time you sign in.",
  ].join("\n");
  async function copy() {
    try { await navigator.clipboard.writeText(message); } catch {
      const t = document.createElement("textarea"); t.value = message; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  function print() {
    const w = window.open("", "_blank", "width=640,height=640");
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    w.document.write(`<html><head><title>Portal credentials</title><style>body{font-family:system-ui,sans-serif;padding:32px;color:#0f172a}h1{font-size:20px}dl{margin-top:20px}dt{font-size:12px;color:#64748b;text-transform:uppercase;margin-top:14px}dd{margin:2px 0 0;font-size:16px;font-weight:700;font-family:ui-monospace,monospace}p{color:#475569;font-size:13px;margin-top:24px}</style></head><body><h1>${esc(portalLabel)} - ${esc(company)}</h1><p style="margin-top:4px">${esc(tenant)}</p><dl><dt>Portal</dt><dd>${esc(url)}</dd><dt>Name</dt><dd>${esc(cred.name)}</dd><dt>Email</dt><dd>${esc(cred.email)}</dd><dt>Temporary password</dt><dd>${esc(cred.password)}</dd></dl><p>You will be asked to choose a new password the first time you sign in. Keep this sheet private.</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  }
  return (
    <div data-testid="credentials-card" className="space-y-3 rounded-2xl border-[1.5px] border-primary/40 bg-primary-50/50 p-4">
      <div className="flex items-center gap-2 text-sm font-extrabold text-dark"><KeyRound size={16} className="text-primary" />Portal credentials for {cred.name}</div>
      <dl className="grid gap-2 text-sm">
        <div><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Portal URL</dt><dd data-testid="cred-url" className="break-all font-mono font-semibold text-dark">{url}</dd></div>
        <div><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Email</dt><dd data-testid="cred-email" className="font-mono font-semibold text-dark">{cred.email}</dd></div>
        <div><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Temporary password</dt><dd data-testid="cred-password" className="font-mono text-base font-extrabold tracking-wide text-dark">{cred.password}</dd></div>
      </dl>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Password is shown only once. Copy it now; you can issue a new temporary password later with Reset password.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={buttonClass("primary", "sm")}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy all"}</button>
        <button type="button" onClick={print} className={buttonClass("secondary", "sm")}><Printer size={13} />Print credentials</button>
        <button type="button" disabled title="Email not configured" className={buttonClass("secondary", "sm")}><Mail size={13} />Email credentials</button>
      </div>
    </div>
  );
}

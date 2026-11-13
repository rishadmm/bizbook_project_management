import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in · Operations Module", robots: { index: false, follow: false } };

/** Minimal branded layout for the sign-in page (outside the app shell). */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  const company = getSetting("company_name", "Al Noor Infrastructure LLC");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><Building2 size={24} /></span>
        <div><div className="text-lg font-semibold leading-tight text-slate-900">{company}</div><div className="text-xs uppercase tracking-wider text-slate-500">Operations</div></div>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </div>
  );
}

import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subcontractor portal", robots: { index: false, follow: false } };

/** Public portal layout: no sidebar/topbar, minimal branded header. */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const company = getSetting("company_name", "Al Noor Infrastructure LLC");
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white"><Building2 size={17} /></span>
          <div>
            <div className="text-sm font-semibold leading-tight text-slate-900">{company}</div>
            <div className="text-[11px] leading-tight text-slate-500">Subcontractor portal</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5 pb-16">{children}</main>
    </div>
  );
}

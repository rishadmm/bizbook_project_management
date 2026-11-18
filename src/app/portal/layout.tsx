import type { Metadata } from "next";
import Logo from "@/components/brand/Logo";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subcontractor portal", robots: { index: false, follow: false } };

/** Public portal layout: no sidebar/topbar, minimal branded header. */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const company = getSetting("company_name");
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo size={30} wordmark={false} />
            <div>
              <div className="text-sm font-extrabold leading-tight tracking-tight text-dark">BizBook <span className="text-primary">Project</span> · Subcontractor portal</div>
              <div className="text-[11px] leading-tight text-muted">{company}</div>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5 pb-16">{children}</main>
    </div>
  );
}

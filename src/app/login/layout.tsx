import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import Logo from "@/components/brand/Logo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

const TASKS = [
  { text: "Prepare tender TND-2026-014", chip: "Completed", done: true },
  { text: "Verify subcontractor progress", chip: "Completed", done: true },
  { text: "Certify invoice SC-004", chip: "In progress", done: false },
];

/** Split-layout sign-in (outside the app shell): brand panel left, form right. */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <section className="relative hidden w-[46%] flex-col overflow-hidden px-12 py-8 lg:flex" style={{ background: "linear-gradient(160deg, #F3F0FF 0%, #EEF2FF 48%, #F8F7FF 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-violet-400/15 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <Logo />
          <a href="https://bizbookerp.com" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-primary"><ArrowLeft size={14} />Back to BizBook ERP</a>
        </div>
        <div className="relative my-auto py-8">
          <h2 className="text-[44px] font-extrabold leading-[1.08] tracking-[-0.03em] text-dark">Welcome back to<br /><span className="text-primary">your projects.</span></h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">Tenders, budgets, sites and subcontractors — all in one connected workspace.</p>

          <div className="mt-8 max-w-md rounded-2xl border border-line bg-white p-5 shadow-[0_20px_50px_rgba(99,91,255,.14)]">
            <div className="flex items-center justify-between">
              <div className="text-sm font-extrabold text-dark">BizBook Project Autopilot</div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-bold text-green-700"><span className="h-1.5 w-1.5 rounded-full bg-success" />Active</span>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border-[1.5px] border-[#e2e8f0] bg-[#f8fafc] py-1.5 pl-3.5 pr-1.5">
              <Sparkles size={15} className="text-primary" />
              <span className="flex-1 text-sm text-[#94a3b8]">What would you like to get done?</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white"><ArrowRight size={15} /></span>
            </div>
            <ul className="mt-3 space-y-2">
              {TASKS.map((t) => (
                <li key={t.text} className="flex items-center gap-2.5 rounded-xl bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-slate-700">
                  {t.done
                    ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-white"><Check size={12} strokeWidth={3} /></span>
                    : <Loader2 size={20} className="animate-spin text-primary" />}
                  <span className="flex-1">{t.text}</span>
                  <span className={t.done ? "rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold text-green-700" : "rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold text-primary"}>{t.chip}</span>
                </li>
              ))}
            </ul>
          </div>

          <ul className="mt-7 space-y-2.5 text-sm font-semibold text-slate-700">
            {["Tender to project in one flow", "Live site progress on the map", "Multi-level approvals & audit trail"].map((x) => (
              <li key={x} className="flex items-center gap-2.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-50 text-primary"><Check size={12} strokeWidth={3} /></span>{x}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted">Part of BizBook ERP. You stay in control.</p>
      </section>

      <section className="flex min-h-screen flex-1 flex-col bg-white px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="lg:hidden"><Logo size={28} /></span>
          <span className="ml-auto">Part of BizBook ERP · <a href="https://bizbookerp.com" className="font-semibold text-primary hover:underline">bizbookerp.com</a></span>
        </div>
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-10">{children}</div>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>© 2026 BizBook ERP · <a href="#" className="hover:text-primary">Privacy</a> · <a href="#" className="hover:text-primary">Terms</a></span>
          <span>🌐 English / العربية</span>
        </footer>
      </section>
    </div>
  );
}

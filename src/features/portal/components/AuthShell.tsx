import { ArrowRight, Check, ClipboardCheck, HardHat, Receipt, Wallet } from "lucide-react";
import Logo from "@/components/brand/Logo";

const BENEFITS = [
  { icon: ClipboardCheck, text: "Submit site progress with photos from your phone" },
  { icon: Receipt, text: "Submit invoices and follow certification" },
  { icon: Wallet, text: "Track payments, retention and your statement" },
];

/** Split layout of the portal sign-in screens (THEME_SPEC section 5): brand panel with the subcontractor's company, form on the right. */
export default function AuthShell({ companyName, tenant, children }: { companyName: string; tenant: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <section className="relative hidden w-[46%] flex-col overflow-hidden px-12 py-8 lg:flex" style={{ background: "linear-gradient(160deg, #F3F0FF 0%, #EEF2FF 48%, #F8F7FF 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-violet-400/15 blur-3xl" />
        <div className="relative flex items-center justify-between"><Logo /><span className="text-sm font-semibold text-slate-500">Part of BizBook ERP</span></div>
        <div className="relative my-auto py-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-[.08em] text-primary shadow-sm"><HardHat size={13} />Subcontractor Portal</span>
          <h2 className="mt-5 text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em] text-dark">{companyName}</h2>
          <p className="mt-2 text-lg font-semibold text-primary">for {tenant}</p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">Your secure workspace for site progress, invoices and payments on {tenant} projects.</p>
          <ul className="mt-8 space-y-3 text-sm font-semibold text-slate-700">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white text-primary shadow-sm"><Icon size={16} /></span>{text}</li>
            ))}
          </ul>
          <div className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500"><Check size={13} className="text-success" />Every action is recorded and verified by the project team<ArrowRight size={12} /></div>
        </div>
        <p className="relative text-xs text-muted">BizBook Project · Subcontractor Portal</p>
      </section>
      <section className="flex min-h-screen flex-1 flex-col bg-white px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between text-xs text-muted"><span className="lg:hidden"><Logo size={28} /></span><span className="ml-auto">{tenant} · Subcontractor Portal</span></div>
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-10">{children}</div>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>© 2026 BizBook ERP</span><span>🌐 English / العربية</span></footer>
      </section>
    </div>
  );
}

import { ArrowRight, BarChart3, Camera, Check, FileText, Map as MapIcon } from "lucide-react";
import Logo from "@/components/brand/Logo";

const BENEFITS = [
  { icon: BarChart3, text: "Live progress against the programme, per project" },
  { icon: MapIcon, text: "Interactive map with plan vs actual work fronts" },
  { icon: FileText, text: "Printable progress, schedule and issue reports" },
  { icon: Camera, text: "Verified site photos as the work advances" },
];

/** Split layout of the client portal sign-in screens (THEME_SPEC section 5): brand panel with the client, form on the right. */
export default function ClientAuthShell({ clientName, tenant, children }: { clientName: string; tenant: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      <section className="relative hidden w-[46%] flex-col overflow-hidden px-12 py-8 lg:flex" style={{ background: "linear-gradient(160deg, #F3F0FF 0%, #EEF2FF 48%, #F8F7FF 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-violet-400/15 blur-3xl" />
        <div className="relative flex items-center justify-between"><Logo /><span className="text-sm font-semibold text-slate-500">Part of BizBook ERP</span></div>
        <div className="relative my-auto py-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-[.08em] text-primary shadow-sm"><BarChart3 size={13} />Client Portal</span>
          <h2 className="mt-5 text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em] text-dark">{clientName}</h2>
          <p className="mt-2 text-lg font-semibold text-primary">Project reporting by {tenant}</p>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">A read-only window into the progress, schedule and issues of your projects with {tenant}.</p>
          <ul className="mt-8 space-y-3 text-sm font-semibold text-slate-700">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white text-primary shadow-sm"><Icon size={16} /></span>{text}</li>
            ))}
          </ul>
          <div className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white/70 px-4 py-2 text-xs font-semibold text-slate-500"><Check size={13} className="text-success" />Only progress verified by the project team is shown<ArrowRight size={12} /></div>
        </div>
        <p className="relative text-xs text-muted">BizBook Project · Client Portal</p>
      </section>
      <section className="flex min-h-screen flex-1 flex-col bg-white px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between text-xs text-muted"><span className="lg:hidden"><Logo size={28} /></span><span className="ml-auto">{tenant} · Client Portal</span></div>
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-10">{children}</div>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><span>© 2026 BizBook ERP</span><span>🌐 English / العربية</span></footer>
      </section>
    </div>
  );
}

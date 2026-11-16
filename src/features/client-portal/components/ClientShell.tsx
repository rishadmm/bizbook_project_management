"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Building2, Camera, ChevronDown, Eye, FileBarChart, FolderKanban, LayoutDashboard, Lock, LogOut, Map as MapIcon, Menu, MessageSquareWarning, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { clientSignOut, exitClientView } from "../auth-actions";

export interface NavEntry { key: string; href: string; label: string }

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, projects: FolderKanban, map: MapIcon, reports: FileBarChart, photos: Camera, issues: MessageSquareWarning, team: Users, account: UserRound,
};
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

function NavLinks({ nav, base, onNavigate }: { nav: NavEntry[]; base: string; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5" aria-label="Portal">
      {nav.map((n) => {
        const Icon = ICONS[n.key] ?? FolderKanban;
        const active = n.href === base ? path === base : path === n.href || path.startsWith(n.href + "/");
        return (
          <Link key={n.key} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors", active ? "bg-primary text-white shadow-brand-sm" : "text-slate-300 hover:bg-white/[0.06] hover:text-white")}>
            <Icon size={17} /><span className="flex-1">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ name, role, email, slug }: { name: string; role: string; email: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" data-testid="client-user-menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-2.5 text-sm font-semibold text-slate-700 hover:bg-primary-50">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-white">{initials(name)}</span>
        <span className="hidden max-w-36 truncate sm:inline">{name}</span><ChevronDown size={14} className="text-slate-400" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 rounded-2xl border border-line bg-white py-1.5 shadow-card">
          <div className="border-b border-slate-100 px-3 py-2"><div className="truncate text-sm font-bold text-dark">{name}</div><div className="truncate text-xs text-slate-500">{role}</div>{email && <div className="truncate text-xs text-slate-400">{email}</div>}</div>
          <Link href={`/c/${slug}/account`} role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-primary-50"><UserRound size={15} />My account</Link>
          <form action={clientSignOut} data-readonly-ok="logout"><button type="submit" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-primary-50"><LogOut size={15} />Sign out</button></form>
        </div>
      )}
    </div>
  );
}

/** Client portal shell: dark sidebar (md+), off-canvas drawer + bottom bar on phones, topbar with client pill, "Read-only access" pill and user menu. */
export default function ClientShell({ slug, clientName, tenant, user, nav, adminView, children }: {
  slug: string; clientName: string; tenant: string; user: { name: string; role: string; email: string }; nav: NavEntry[]; adminView: string | null; children: React.ReactNode;
}) {
  const base = `/c/${slug}`;
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  useEffect(() => { setDrawer(false); }, [path]);
  const bottom = nav.filter((n) => ["dashboard", "projects", "map", "reports", "issues"].includes(n.key)).slice(0, 5);
  const brand = (
    <div className="px-4 pb-3 pt-4">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-extrabold tracking-tighter text-white">{initials(clientName)}</span>
        <div className="min-w-0"><div className="truncate text-[15px] font-extrabold leading-tight text-white" data-testid="client-name">{clientName}</div><div className="text-[11px] leading-tight text-muted">Client Portal · BizBook</div></div>
      </div>
    </div>
  );
  return (
    <div className="flex min-h-screen bg-background">
      {adminView && (
        <div role="status" data-testid="admin-view-banner" className="no-print fixed inset-x-0 top-0 z-[3000] flex items-center justify-center gap-3 bg-amber-400 px-3 py-1.5 text-sm font-bold text-amber-950">
          <Eye size={15} /><span>Viewing as {clientName} — read only</span><span className="hidden text-xs font-semibold opacity-70 sm:inline">({adminView})</span>
          <form action={exitClientView} data-readonly-ok="logout"><button type="submit" className="rounded-md bg-amber-950 px-2.5 py-0.5 text-xs font-bold text-amber-50 hover:bg-black">Exit</button></form>
        </div>
      )}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-sidebar text-slate-300 md:flex">
        {brand}
        <div className="flex-1 overflow-y-auto px-3 pb-3"><NavLinks nav={nav} base={base} /></div>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 px-1"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-white">{initials(user.name)}</span>
            <div className="min-w-0"><div className="truncate text-sm font-bold text-white">{user.name}</div><div className="truncate text-[11px] text-muted">{user.role}</div></div></div>
        </div>
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-[2500] md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-sidebar text-slate-300 shadow-2xl">
            <div className="flex items-start justify-between">{brand}<button type="button" aria-label="Close menu" onClick={() => setDrawer(false)} className="m-3 rounded p-1 text-slate-400 hover:text-white"><X size={20} /></button></div>
            <div className="flex-1 overflow-y-auto px-3 pb-6"><NavLinks nav={nav} base={base} onNavigate={() => setDrawer(false)} /></div>
          </div>
        </div>
      )}
      <div className={cn("flex min-w-0 flex-1 flex-col", adminView && "pt-9")}>
        <header className={cn("sticky z-[1100] flex h-16 items-center gap-3 border-b border-line bg-white/90 px-3 backdrop-blur md:px-6", adminView ? "top-9" : "top-0")}>
          <button type="button" aria-label="Open menu" onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-600 hover:bg-primary-50 md:hidden"><Menu size={20} /></button>
          <span className="inline-flex max-w-[45vw] items-center gap-1.5 truncate rounded-full bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary"><Building2 size={14} className="shrink-0" /><span className="truncate">{clientName}</span></span>
          <span data-testid="read-only-pill" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-600"><Lock size={12} className="shrink-0" /><span className="hidden sm:inline">Read-only access</span><span className="sm:hidden">Read-only</span></span>
          <span className="hidden text-xs font-semibold text-slate-400 lg:inline">Reporting by {tenant}</span>
          <div className="ml-auto flex items-center gap-2"><UserMenu name={user.name} role={user.role} email={user.email} slug={slug} /></div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-24 md:p-6 md:pb-6">{children}</main>
        <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-[1200] flex border-t border-line bg-white md:hidden">
          {bottom.map((n) => {
            const Icon = ICONS[n.key] ?? FolderKanban;
            const active = n.href === base ? path === base : path.startsWith(n.href);
            return <Link key={n.key} href={n.href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold", active ? "text-primary" : "text-slate-500")}><Icon size={19} />{n.label.split(" ")[0]}</Link>;
          })}
        </nav>
      </div>
    </div>
  );
}

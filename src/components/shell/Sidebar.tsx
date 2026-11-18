"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckSquare, ExternalLink, FileText, FolderKanban, Gavel, GitBranch, HardHat, Mail, LayoutDashboard, type LucideIcon, Radar, Receipt, ScrollText, Settings, ShieldCheck, TrendingDown, UserCog, Users,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { NAV_ITEMS, type ModuleKey, type NavItem } from "@/lib/permissions";

const ICONS: Partial<Record<ModuleKey, LucideIcon>> = {
  dashboard: LayoutDashboard, procurement: Gavel, tenders: FileText, lost_analysis: TrendingDown, projects: FolderKanban, ops_map: Radar, subcontractors: HardHat, invoices: Receipt,
  clients: Users, approvals: CheckSquare, users: UserCog, roles: ShieldCheck, approval_setup: GitBranch, audit: ScrollText, settings: Settings,
};

/** Entries that share a module with another entry get their own icon. */
const HREF_ICONS: Record<string, LucideIcon> = { "/admin/email-outbox": Mail };

/** Sidebar groups (display only); unknown modules fall back to "Overview". */
const GROUPS: { label: string; modules: ModuleKey[] }[] = [
  { label: "Overview", modules: ["dashboard", "approvals"] },
  { label: "Sales & Tendering", modules: ["tenders", "lost_analysis", "clients"] },
  { label: "Projects", modules: ["projects", "procurement", "ops_map"] },
  { label: "Subcontracting", modules: ["subcontractors"] },
  { label: "Finance", modules: ["invoices"] },
];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

/**
 * Sidebar filtered by view permission. `allowed` = modules the user may view.
 * `approvalsBadge` = pending approval count shown next to "Approvals" (wired up by the approval engine; undefined hides it).
 */
export default function Sidebar({ allowed, approvalsBadge, subsBadge, user, logo }: { logo?: React.ReactNode; companyName?: string; allowed: ModuleKey[]; approvalsBadge?: number; subsBadge?: number; user?: { name: string; role: string } }) {
  const path = usePathname();
  const items = NAV_ITEMS.filter((n) => allowed.includes(n.module));
  const link = ({ href, label, module }: NavItem) => {
    const Icon = HREF_ICONS[href] ?? ICONS[module] ?? FileText;
    const active = isActive(path, href);
    return (
      <Link key={href} href={href} aria-current={active ? "page" : undefined}
        className={cn("flex items-center gap-3 rounded-[10px] px-3 py-1.5 text-sm font-semibold transition-colors", active ? "bg-primary text-white shadow-brand-sm" : "text-slate-300 hover:bg-white/[0.06] hover:text-white")}>
        <Icon size={17} />
        <span className="flex-1">{label}</span>
        {/* approvals pending-count badge slot */}
        {module === "subcontractors" && subsBadge ? <span data-testid="subs-badge" title="Registrations waiting for review" className={cn("rounded-full px-1.5 text-[10px] font-bold leading-4", active ? "bg-white text-primary" : "bg-primary text-white")}>{subsBadge}</span> : null}
        {module === "approvals" && approvalsBadge ? <span data-testid="approvals-badge" className={cn("rounded-full px-1.5 text-[10px] font-bold leading-4", active ? "bg-white text-primary" : "bg-primary text-white")}>{approvalsBadge}</span> : null}
      </Link>
    );
  };
  const groupLabel = (t: string) => <div className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[.08em] text-muted">{t}</div>;
  const grouped = new Set<ModuleKey>(GROUPS.flatMap((g) => g.modules));
  const admin = items.filter((n) => n.section === "admin");
  const stray = items.filter((n) => n.section !== "admin" && !grouped.has(n.module));
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-sidebar text-slate-300 md:flex">
      <div className="px-4 pb-3 pt-4">
        {logo}
        <div className="mt-1.5 pl-[42px] text-[11px] text-muted">Project module · BizBook ERP</div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
        {GROUPS.map((g) => {
          const gi = items.filter((n) => g.modules.includes(n.module));
          return gi.length ? <div key={g.label}>{groupLabel(g.label)}<div className="space-y-0.5">{gi.map(link)}</div></div> : null;
        })}
        {stray.length > 0 && <div className="mt-2 space-y-0.5">{stray.map(link)}</div>}
        {admin.length > 0 && <div>{groupLabel("Administration")}<div className="space-y-0.5">{admin.map(link)}</div></div>}
      </nav>
      <div className="border-t border-white/10 p-3">
        {user && (
          <div className="flex items-center gap-2.5 px-1 pb-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-white">{initials(user.name)}</span>
            <div className="min-w-0"><div className="truncate text-sm font-bold text-white">{user.name}</div><div className="truncate text-[11px] text-muted">{user.role}</div></div>
          </div>
        )}
        <a href="https://bizbookerp.com" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-xs font-semibold text-muted hover:bg-white/[0.06] hover:text-white">
          <ExternalLink size={13} />BizBook ERP
        </a>
      </div>
    </aside>
  );
}

/** Compact nav for small screens (same permission filtering). */
export function MobileNav({ allowed, approvalsBadge }: { allowed: ModuleKey[]; approvalsBadge?: number }) {
  const path = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line bg-white px-2 py-1.5 md:hidden">
      {NAV_ITEMS.filter((n) => allowed.includes(n.module)).map(({ href, label, module }) => (
        <Link key={href} href={href} className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold", isActive(path, href) ? "bg-primary text-white" : "text-slate-600")}>
          {label}{module === "approvals" && approvalsBadge ? ` (${approvalsBadge})` : ""}
        </Link>
      ))}
    </div>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, CheckSquare, FileText, FolderKanban, GitBranch, HardHat, LayoutDashboard, type LucideIcon, Receipt, ScrollText, Settings, ShieldCheck, TrendingDown, UserCog, Users,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { NAV_ITEMS, type ModuleKey, type NavItem } from "@/lib/permissions";

const ICONS: Partial<Record<ModuleKey, LucideIcon>> = {
  dashboard: LayoutDashboard, tenders: FileText, lost_analysis: TrendingDown, projects: FolderKanban, subcontractors: HardHat, invoices: Receipt,
  clients: Users, approvals: CheckSquare, users: UserCog, roles: ShieldCheck, approval_setup: GitBranch, audit: ScrollText, settings: Settings,
};

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

/**
 * Sidebar filtered by view permission. `allowed` = modules the user may view.
 * `approvalsBadge` = pending approval count shown next to "Approvals" (wired up by the approval engine; undefined hides it).
 */
export default function Sidebar({ companyName, allowed, approvalsBadge }: { companyName: string; allowed: ModuleKey[]; approvalsBadge?: number }) {
  const path = usePathname();
  const items = NAV_ITEMS.filter((n) => allowed.includes(n.module));
  const link = ({ href, label, module }: NavItem) => {
    const Icon = ICONS[module] ?? FileText;
    return (
      <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium", isActive(path, href) ? "bg-blue-600 text-white" : "hover:bg-slate-800 hover:text-white")}>
        <Icon size={17} />
        <span className="flex-1">{label}</span>
        {/* approvals pending-count badge slot */}
        {module === "approvals" && approvalsBadge ? <span data-testid="approvals-badge" className="rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white">{approvalsBadge}</span> : null}
      </Link>
    );
  };
  const admin = items.filter((n) => n.section === "admin");
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-slate-900 text-slate-300 md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-slate-800 px-4">
        <Building2 className="text-blue-400" size={20} />
        <div className="min-w-0"><div className="truncate text-sm font-semibold text-white">{companyName}</div><div className="text-[10px] uppercase tracking-wider text-slate-500">Operations</div></div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Main">
        {items.filter((n) => n.section === "main").map(link)}
        {admin.length > 0 && <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Administration</div>}
        {admin.map(link)}
      </nav>
    </aside>
  );
}

/** Compact nav for small screens (same permission filtering). */
export function MobileNav({ allowed, approvalsBadge }: { allowed: ModuleKey[]; approvalsBadge?: number }) {
  const path = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5 md:hidden">
      {NAV_ITEMS.filter((n) => allowed.includes(n.module)).map(({ href, label, module }) => (
        <Link key={href} href={href} className={cn("whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium", isActive(path, href) ? "bg-blue-600 text-white" : "text-slate-600")}>
          {label}{module === "approvals" && approvalsBadge ? ` (${approvalsBadge})` : ""}
        </Link>
      ))}
    </div>
  );
}

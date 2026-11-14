import Link from "next/link";
import { Bell, Building2, Search } from "lucide-react";
import { getSetting } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getPendingCount } from "@/lib/approvals/engine";
import { visibleModules } from "@/lib/permissions";
import Logo from "@/components/brand/Logo";
import Sidebar, { MobileNav } from "@/components/shell/Sidebar";
import UserMenu from "@/components/shell/UserMenu";

export const dynamic = "force-dynamic";

/** App shell (sidebar + topbar). Everything except /portal and /login lives under this route group. */
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const company = getSetting("company_name", "Al Noor Infrastructure LLC");
  const allowed = me.must_change_password ? [] : visibleModules(me.permissions, me.isSuperAdmin);
  // Pending-approvals badge: wired by the approval engine (Phase 2 section D). `undefined` = hidden.
  const approvalsBadge: number | undefined = me.must_change_password ? undefined : getPendingCount(me.id) || undefined;
  return (
    <div className="flex min-h-screen">
      <Sidebar logo={<Logo dark />} companyName={company} allowed={allowed} approvalsBadge={approvalsBadge} user={{ name: me.name, role: me.roleName }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1100] flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur md:px-6">
          <form action="/search" className="relative max-w-md flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" placeholder="Search tenders, projects, subcontractors…" className="w-full rounded-xl border-[1.5px] border-[#e2e8f0] bg-[#f8fafc] py-2 pl-9 pr-3 text-sm placeholder:text-[#94a3b8] focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/15" />
          </form>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary lg:inline-flex"><Building2 size={14} />{company}</span>
            {allowed.includes("approvals") && (
              <Link href="/approvals" aria-label="Approvals" className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-primary-50 hover:text-primary">
                <Bell size={18} />
                {approvalsBadge ? <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-4 text-white">{approvalsBadge}</span> : null}
              </Link>
            )}
            <UserMenu name={me.name} role={me.roleName} email={me.email} />
          </div>
        </header>
        <MobileNav allowed={allowed} approvalsBadge={approvalsBadge} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

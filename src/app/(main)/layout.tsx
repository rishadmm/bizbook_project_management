import { Search } from "lucide-react";
import { getSetting } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { visibleModules } from "@/lib/permissions";
import Sidebar, { MobileNav } from "@/components/shell/Sidebar";
import UserMenu from "@/components/shell/UserMenu";

export const dynamic = "force-dynamic";

/** App shell (sidebar + topbar). Everything except /portal and /login lives under this route group. */
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const company = getSetting("company_name", "Al Noor Infrastructure LLC");
  const allowed = me.must_change_password ? [] : visibleModules(me.permissions, me.isSuperAdmin);
  // Pending-approvals badge: wired by the approval engine (Phase 2 section D). `undefined` = hidden.
  const approvalsBadge: number | undefined = undefined;
  return (
    <div className="flex min-h-screen">
      <Sidebar companyName={company} allowed={allowed} approvalsBadge={approvalsBadge} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1100] flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <form action="/search" className="relative max-w-md flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input name="q" placeholder="Search tenders, projects, subcontractors…" className="w-full rounded-md border border-slate-300 bg-slate-50 py-1.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" />
          </form>
          <div className="ml-auto flex items-center gap-3"><UserMenu name={me.name} role={me.roleName} email={me.email} /></div>
        </header>
        <MobileNav allowed={allowed} approvalsBadge={approvalsBadge} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

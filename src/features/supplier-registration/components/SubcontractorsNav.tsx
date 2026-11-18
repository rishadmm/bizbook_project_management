import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { can, type AuthUser } from "@/lib/auth";
import { queueCounts } from "../queries";

/** Sub-navigation of the supplier area: All suppliers · Registrations (badge) · Categories · Document types. */
export default function SubcontractorsNav({ active, user, entityId }: { active: "all" | "registrations" | "categories" | "types"; user: AuthUser; entityId: number }) {
  const c = queueCounts(entityId);
  const open = c.submitted + c.under_review + c.referred_back;
  const tabs = [
    { key: "all", label: "All suppliers", href: "/subcontractors" },
    { key: "registrations", label: "Registrations", href: "/subcontractors/registrations", badge: open || undefined },
    ...(can(user, "subcontractors", "setup") ? [{ key: "categories", label: "Categories", href: "/subcontractors/categories" }, { key: "types", label: "Document types", href: "/subcontractors/document-types" }] : []),
  ];
  return (
    <nav aria-label="Supplier area" data-testid="subs-nav" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cn("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold", active === t.key ? "border-primary font-bold text-primary" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")}>
          {t.label}{"badge" in t && t.badge ? <span data-testid="reg-queue-badge" className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-white">{t.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

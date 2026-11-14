import { getSetting } from "@/lib/db";
import { requirePortalUser } from "@/lib/portal-auth";
import { portalCan, portalRoleLabel, type PortalPerm } from "@/lib/portal-core";
import { getActionItems, getRecentEvents } from "@/features/portal/data";
import PortalShell, { type NavEntry, type Note } from "@/features/portal/components/PortalShell";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const NAV: { key: string; label: string; path: string; perm: PortalPerm | null }[] = [
  { key: "dashboard", label: "Dashboard", path: "", perm: "dashboard" },
  { key: "projects", label: "Projects", path: "/projects", perm: "projects" },
  { key: "progress", label: "Progress updates", path: "/progress", perm: "progress" },
  { key: "invoices", label: "Invoices", path: "/invoices", perm: "invoices" },
  { key: "certificates", label: "Certificates", path: "/certificates", perm: "certificates" },
  { key: "payments", label: "Payments & statement", path: "/payments", perm: "payments" },
  { key: "issues", label: "Issues & RFIs", path: "/issues", perm: "issues" },
  { key: "documents", label: "Documents", path: "/documents", perm: "documents" },
  { key: "team", label: "Team", path: "/team", perm: "team" },
  { key: "account", label: "My account", path: "/account", perm: null },
];

export default async function PortalAppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug);
  const nav: NavEntry[] = NAV.filter((n) => !n.perm || portalCan(s.user.role, n.perm)).map((n) => ({ key: n.key, label: n.label, href: `/p/${slug}${n.path}` }));
  const since = s.user.previousLoginAt?.slice(0, 10) ?? null;
  const notes: Note[] = [
    ...getActionItems(s).map((a): Note => ({ key: a.key, title: a.title, detail: a.detail, href: a.href, kind: "action" })),
    ...(since ? getRecentEvents(s, 20).filter((e) => e.date.slice(0, 10) >= since).slice(0, 6).map((e): Note => ({ key: e.key, title: e.text, detail: formatDate(e.date), href: e.href, kind: "event" })) : []),
  ];
  return (
    <PortalShell slug={slug} companyName={s.sub.name} tenant={getSetting("company_name", "Al Noor Infrastructure LLC")} user={{ name: s.user.name, role: portalRoleLabel(s.user.role), email: s.user.email }}
      nav={nav} notes={notes} adminView={s.impersonator ? `${s.impersonator.name}` : null}>
      {children}
    </PortalShell>
  );
}

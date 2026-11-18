import MapCenterInit from "@/components/map/MapCenterInit";
import CurrencyProvider from "@/components/CurrencyProvider";
import { isRestricted, requirePortalUser } from "@/lib/portal-auth";
import { portalCan, portalRoleLabel, type PortalPerm } from "@/lib/portal-core";
import { getActionItems, getRecentEvents } from "@/features/portal/data";
import PortalShell, { type NavEntry, type Note } from "@/features/portal/components/PortalShell";
import { formatDate } from "@/lib/format";
import { getDb } from "@/lib/db";
import { opportunityCount, openRequestCount } from "@/features/procurement/portal-queries";
import { getProfile } from "@/features/supplier-registration/core";
import { listNotifications } from "@/features/supplier-registration/queries";
import RegistrationBanner from "@/features/supplier-registration/components/RegistrationBanner";

export const dynamic = "force-dynamic";

const NAV: { key: string; label: string; path: string; perm: PortalPerm | null }[] = [
  { key: "dashboard", label: "Dashboard", path: "", perm: "dashboard" },
  { key: "registration", label: "Registration", path: "/registration", perm: "registration" },
  { key: "tenders", label: "Tenders", path: "/tenders", perm: "tenders" },
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
  const restricted = isRestricted(s.sub);
  const nav: NavEntry[] = NAV.filter((n) => (!n.perm || portalCan(s.user.role, n.perm)) && (!restricted || ["dashboard", "registration", "documents", "account"].includes(n.key))).map((n) => ({ key: n.key, label: n.label, href: `/p/${slug}${n.path}`, badge: n.key === "tenders" ? opportunityCount(s.sub.id, s.entity.id) + openRequestCount(s.sub.id) : undefined }));
  const since = s.user.previousLoginAt?.slice(0, 10) ?? null;
  const notices: Note[] = listNotifications(s.sub.id, s.user.id, 8).map((n): Note => ({ key: `n${n.id}`, title: n.title, detail: n.body ?? formatDate(n.created_at.slice(0, 10)), href: `/p/${slug}/notifications/${n.id}`, kind: "notice", unread: !n.read_at }));
  const profile = restricted ? getProfile(getDb(), s.sub.id) : undefined;
  const notes: Note[] = [
    ...notices,
    ...(restricted ? [] : getActionItems(s).map((a): Note => ({ key: a.key, title: a.title, detail: a.detail, href: a.href, kind: "action" }))),
    ...(since && !restricted ? getRecentEvents(s, 20).filter((e) => e.date.slice(0, 10) >= since).slice(0, 6).map((e): Note => ({ key: e.key, title: e.text, detail: formatDate(e.date), href: e.href, kind: "event" })) : []),
  ];
  return (
    <PortalShell slug={slug} companyName={s.sub.name} tenant={s.entity.legal_name} user={{ name: s.user.name, role: portalRoleLabel(s.user.role), email: s.user.email }}
      nav={nav} notes={notes} adminView={s.impersonator ? `${s.impersonator.name}` : null}>
      <MapCenterInit value={s.entity.map_center ?? ""} />
      <CurrencyProvider currency={s.entity.currency}>
        {profile && <RegistrationBanner p={profile} slug={slug} entityName={s.entity.legal_name} />}
        {children}
      </CurrencyProvider>
    </PortalShell>
  );
}

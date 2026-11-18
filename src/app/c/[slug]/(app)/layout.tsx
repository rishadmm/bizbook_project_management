import MapCenterInit from "@/components/map/MapCenterInit";
import CurrencyProvider from "@/components/CurrencyProvider";
import { requireClientUser } from "@/lib/client-portal-auth";
import { clientRoleLabel } from "@/lib/client-portal-core";
import ClientShell, { type NavEntry } from "@/features/client-portal/components/ClientShell";

export const dynamic = "force-dynamic";

const NAV: { key: string; label: string; path: string; adminOnly?: boolean }[] = [
  { key: "dashboard", label: "Dashboard", path: "" },
  { key: "projects", label: "Projects", path: "/projects" },
  { key: "map", label: "Live map", path: "/map" },
  { key: "reports", label: "Reports", path: "/reports" },
  { key: "photos", label: "Photos", path: "/photos" },
  { key: "issues", label: "Issues & delays", path: "/issues" },
  { key: "team", label: "Team", path: "/team", adminOnly: true },
  { key: "account", label: "My account", path: "/account" },
];

export default async function ClientAppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireClientUser(slug);
  const nav: NavEntry[] = NAV.filter((n) => !n.adminOnly || s.user.role === "admin").map((n) => ({ key: n.key, label: n.label, href: `/c/${slug}${n.path}` }));
  return (
    <ClientShell slug={slug} clientName={s.client.name} tenant={s.entity.legal_name} user={{ name: s.user.name, role: clientRoleLabel(s.user.role), email: s.user.email }}
      nav={nav} adminView={s.impersonator ? s.impersonator.name : null}>
      <MapCenterInit value={s.entity.map_center ?? ""} />
      <CurrencyProvider currency={s.entity.currency}>{children}</CurrencyProvider>
    </ClientShell>
  );
}

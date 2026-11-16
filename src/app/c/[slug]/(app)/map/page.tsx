import { requireClientUser } from "@/lib/client-portal-auth";
import { getClientMap } from "@/features/client-portal/map-server";
import ClientMapLoader from "@/features/client-portal/components/ClientMapLoader";

export const metadata = { title: "Live map" };
export const dynamic = "force-dynamic";

type SP = { project?: string; segment?: string; color?: string; date?: string; sub?: string; embed?: string };

/** Live Ops Map in client mode: only this client's projects, no cost views, no internal links. The payload is stripped server side (map-server.ts). */
export default async function ClientMapPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const s = await requireClientUser(slug);
  const sp = await searchParams;
  const { payload } = getClientMap(s);
  return <ClientMapLoader payload={payload} initial={{ project: sp.project ?? null, segment: sp.segment ?? null, color: sp.color ?? null, date: sp.date ?? null, sub: payload.showSubs ? sp.sub ?? null : null, embed: sp.embed === "1" }} />;
}

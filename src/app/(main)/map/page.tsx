import { can, getActiveEntity, requirePage } from "@/lib/auth";
import { getOpsMapData } from "@/features/ops-map/queries";
import OpsMapLoader from "@/features/ops-map/components/OpsMapLoader";

export const metadata = { title: "Live Ops Map" };
export const dynamic = "force-dynamic";

type SP = { project?: string; segment?: string; color?: string; date?: string; sub?: string; embed?: string };

/** Live Ops Map: interactive project command centre (MAP_SPEC.md). Fills the viewport under the topbar. */
export default async function MapPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePage("ops_map");
  const sp = await searchParams;
  const entity = await getActiveEntity();
  const data = getOpsMapData({ includePortal: can(me, "subcontractors", "view"), entityId: entity.id });
  return <OpsMapLoader data={data} initial={{ project: sp.project ?? null, segment: sp.segment ?? null, color: sp.color ?? null, date: sp.date ?? null, sub: sp.sub ?? null, embed: sp.embed === "1" }} />;
}

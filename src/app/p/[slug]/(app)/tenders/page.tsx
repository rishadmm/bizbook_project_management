import Link from "next/link";
import { Badge, CardSection, EmptyState, PageHeader, StatusBadge, Table, TBody, TD, TH, THead, TR, Tabs, type TabDef } from "@/components/ui";
import { requirePortalUser } from "@/lib/portal-auth";
import { countdown, formatLocal } from "@/lib/rfx";
import { portalTenders, type PortalTab } from "@/features/procurement/portal-queries";

export const metadata = { title: "Tenders" };
const TABS: { key: PortalTab; label: string }[] = [{ key: "opportunities", label: "Opportunities" }, { key: "bids", label: "My bids" }, { key: "closed", label: "Closed" }, { key: "awarded", label: "Awarded" }];

export default async function PortalTenders({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug, "tenders");
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.key === sp.tab)?.key ?? "opportunities") as PortalTab;
  const counts = Object.fromEntries(TABS.map((t) => [t.key, portalTenders(s.sub.id, s.entity.id, t.key).length])) as Record<PortalTab, number>;
  const rows = portalTenders(s.sub.id, s.entity.id, tab);
  const tabs: TabDef[] = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }));
  return (
    <>
      <PageHeader title="Supplier tenders" description={`Tenders of ${s.entity.legal_name} that you are invited to or eligible for. Prices and documents of other bidders are never shown.`} />
      <Tabs tabs={tabs} active={tab} basePath={`/p/${slug}/tenders`} />
      <CardSection flush>
        {rows.length === 0 ? <div className="p-5"><EmptyState title="Nothing here" description={tab === "opportunities" ? "No open tender matches your approved categories right now." : "No tenders in this list."} /></div> : (
          <Table>
            <THead><TR><TH>Tender</TH><TH>Category</TH><TH>Closing</TH><TH>My bid</TH><TH>Status</TH></TR></THead>
            <TBody>{rows.map((t) => (
              <TR key={t.id} data-testid="portal-tender-row">
                <TD className="min-w-[240px]"><Link href={`/p/${slug}/tenders/${t.id}`} className="font-bold text-primary-dark hover:underline">{t.code}</Link><div className="max-w-[320px] truncate text-xs text-slate-500" title={t.title}>{t.title}</div></TD>
                <TD className="max-w-[160px] text-xs">{t.category_name ?? "—"}</TD>
                <TD className="whitespace-nowrap text-xs">{formatLocal(t.closing_at)}{t.status === "published" && <div className="text-slate-400">{countdown(t.closing_at)}</div>}</TD>
                <TD>{t.my_status ? <StatusBadge kind="rfxBidStatus" value={t.my_status === "unsuccessful" || t.status === "awarded" ? t.my_status : t.my_status === "qualified" || t.my_status === "disqualified" ? "submitted" : t.my_status} /> : t.intent === "interested" ? <Badge tone="green">Interested</Badge> : <span className="text-slate-300">—</span>}</TD>
                <TD><StatusBadge kind="rfxStatus" value={t.status === "published" ? "published" : t.status === "awarded" ? "awarded" : "closed"} /></TD>
              </TR>))}</TBody>
          </Table>)}
      </CardSection>
    </>
  );
}

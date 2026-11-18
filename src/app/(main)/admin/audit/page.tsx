import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listAudit, lookups } from "@/features/admin/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

const EVENTS = ["login_success", "login_failed", "logout", "locked", "password_changed", "password_reset", "session_revoked", "user_created", "user_disabled", "user_enabled", "user_unlocked", "user_updated", "role_changed", "permissions_changed", "entity_switched", "entity_updated", "fx_updated"];
type SP = { user?: string; event?: string; from?: string; to?: string; source?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("audit");
  const sp = await searchParams;
  const rows = listAudit(sp);
  const { users } = lookups();
  return (
    <>
      <PageHeader title="Audit log" description="Sign-in events, administration changes and business activity (latest 300)." />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Select name="user" defaultValue={sp.user ?? ""} options={users.map((u) => ({ value: u.id, label: u.name }))} placeholder="All users" className="w-44" />
        <Select name="source" defaultValue={sp.source ?? ""} options={[{ value: "auth", label: "Authentication / admin" }, { value: "activity", label: "Business activity" }]} placeholder="All sources" className="w-48" />
        <Select name="event" defaultValue={sp.event ?? ""} options={EVENTS.map((e) => ({ value: e, label: e }))} placeholder="All auth events" className="w-48" />
        <Input name="from" type="date" defaultValue={sp.from} className="w-40" aria-label="From date" />
        <Input name="to" type="date" defaultValue={sp.to} className="w-40" aria-label="To date" />
        <Button type="submit">Filter</Button>
        <Link href="/admin/audit" className="px-2 py-2 text-sm text-slate-500 hover:underline">Reset</Link>
      </form>
      <CardSection flush>
        <Table>
          <THead><TR><TH>When (UTC)</TH><TH>User</TH><TH>Source</TH><TH>Event</TH><TH>Detail</TH><TH>IP</TH></TR></THead>
          <TBody>
            {rows.map((e, i) => (
              <TR key={i}>
                <TD className="whitespace-nowrap">{formatDateTime(new Date(e.ts).toISOString())}</TD><TD>{e.userName ?? "—"}</TD>
                <TD><Badge tone={e.source === "auth" ? "indigo" : "slate"}>{e.source === "auth" ? "Auth" : "Activity"}</Badge></TD>
                <TD className="whitespace-nowrap">{e.event}</TD><TD className="max-w-md text-slate-500">{e.detail}</TD><TD>{e.ip ?? "—"}</TD>
              </TR>
            ))}
            {rows.length === 0 && <TR><TD colSpan={6} className="py-6 text-center text-slate-400">No entries.</TD></TR>}
          </TBody>
        </Table>
      </CardSection>
    </>
  );
}

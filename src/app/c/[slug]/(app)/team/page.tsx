import { Badge, CardSection, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getDb, getSetting } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { parseDbDate } from "@/lib/auth";
import { requireClientUser } from "@/lib/client-portal-auth";
import { clientRoleLabel } from "@/lib/client-portal-core";

export const metadata = { title: "Team" };

export default async function ClientTeam({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireClientUser(slug, "team");
  const users = getDb().prepare("SELECT id, name, email, job_title, role, status, locked_until, last_login_at FROM client_users WHERE client_id = ? ORDER BY id").all(s.client.id) as
    { id: number; name: string; email: string; job_title: string | null; role: string; status: string; locked_until: string | null; last_login_at: string | null }[];
  return (
    <>
      <PageHeader title="Team" description={`People at ${s.client.name} with access to this portal. Contact your project manager to add or change users.`} />
      <CardSection flush>
        <Table>
          <THead><TR><TH>User</TH><TH>Role</TH><TH>Status</TH><TH>Last sign-in</TH></TR></THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id} data-testid="team-row">
                <TD><div className="font-bold text-dark">{u.name}</div><div className="text-xs text-slate-500">{u.email}</div>{u.job_title && <div className="text-xs text-slate-400">{u.job_title}</div>}</TD>
                <TD>{clientRoleLabel(u.role)}</TD>
                <TD>{u.status === "disabled" ? <Badge tone="slate">Disabled</Badge> : u.locked_until && parseDbDate(u.locked_until) > Date.now() ? <Badge tone="red">Locked</Badge> : <Badge tone="green">Active</Badge>}</TD>
                <TD className="whitespace-nowrap text-xs">{u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardSection>
      <p className="mt-3 text-xs text-slate-400">Contact {getSetting("company_name", "Al Noor Infrastructure LLC")} to add users.</p>
    </>
  );
}

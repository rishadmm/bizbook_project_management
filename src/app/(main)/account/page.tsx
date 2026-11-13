import { getDb } from "@/lib/db";
import { getSession, requirePage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { revokeOtherSessions } from "@/features/auth/actions";
import { PasswordForm, ProfileForm } from "./forms";

type SessionRow = { id: number; created_at: string; last_seen_at: string | null; expires_at: string; ip: string | null; user_agent: string | null };

export default async function AccountPage() {
  const me = await requirePage();
  const s = await getSession();
  const sessions = getDb().prepare("SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC")
    .all(me.id, new Date().toISOString()) as SessionRow[];
  return (
    <>
      <PageHeader title="My account" description={`${me.email ?? ""} · ${me.roleName}`} />
      <div className="space-y-5">
        <CardSection title="Profile"><ProfileForm name={me.name} phone={me.phone ?? ""} jobTitle={me.job_title ?? ""} /></CardSection>
        <CardSection title="Change password"><PasswordForm /></CardSection>
        <CardSection title="Active sessions" subtitle="Devices currently signed in to your account." flush
          actions={sessions.length > 1 ? <form action={revokeOtherSessions}><Button type="submit" size="sm" variant="danger">Sign out other sessions</Button></form> : undefined}>
          <Table>
            <THead><TR><TH>Started</TH><TH>Last active</TH><TH>IP</TH><TH>Device</TH><TH /></TR></THead>
            <TBody>
              {sessions.map((x) => (
                <TR key={x.id}>
                  <TD>{formatDateTime(x.created_at)}</TD><TD>{x.last_seen_at ? formatDateTime(x.last_seen_at) : "—"}</TD><TD>{x.ip ?? "—"}</TD>
                  <TD className="max-w-xs truncate" title={x.user_agent ?? ""}>{x.user_agent ?? "—"}</TD>
                  <TD>{x.id === s?.sessionId && <Badge tone="blue">This session</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardSection>
      </div>
    </>
  );
}

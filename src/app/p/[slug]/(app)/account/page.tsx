import { CardSection, Badge, Button, PageHeader } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { portalRoleLabel } from "@/lib/portal-core";
import { PasswordForm, ProfileForm } from "@/features/portal/components/AccountForms";
import { portalRevokeOtherSessions } from "@/features/portal/auth-actions";

export const metadata = { title: "My account" };

export default async function AccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug);
  const sessions = s.readOnly ? [] : (getDb().prepare("SELECT id, created_at, last_seen_at, ip, user_agent FROM portal_sessions WHERE portal_user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC").all(s.user.id, new Date().toISOString()) as
    { id: number; created_at: string; last_seen_at: string | null; ip: string | null; user_agent: string | null }[]);
  return (
    <>
      <PageHeader title="My account" description={`${portalRoleLabel(s.user.role)} · ${s.sub.name}`} />
      {s.readOnly && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Read-only admin view: account changes are disabled.</p>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="Profile"><ProfileForm name={s.user.name} phone={s.user.phone ?? ""} jobTitle={s.user.jobTitle ?? ""} email={s.user.email} disabled={s.readOnly} /></CardSection>
        <CardSection title="Change password"><PasswordForm disabled={s.readOnly} /></CardSection>
        <CardSection title="Active sessions" subtitle="Devices currently signed in to your account" className="lg:col-span-2"
          actions={sessions.length > 1 ? <form action={portalRevokeOtherSessions}><Button type="submit" size="sm" variant="secondary">Sign out other sessions</Button></form> : undefined}>
          {sessions.length === 0 ? <p className="text-sm text-slate-400">No sessions to show.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {sessions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-semibold text-slate-700">{(x.user_agent ?? "Unknown device").replace(/\(.*?\)/g, "").slice(0, 60)}</span>
                  {x.id === s.sessionId && <Badge tone="green">This device</Badge>}
                  <span className="ml-auto text-xs text-slate-400">{x.ip ?? ""} · signed in {formatDateTime(x.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardSection>
      </div>
    </>
  );
}

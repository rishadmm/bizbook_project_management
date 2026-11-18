import { notFound } from "next/navigation";
import { can, getSession, parseDbDate, requirePage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getUserRow, listAudit, lookups, rolePermissionKeys, userEntityAccess, userOverrides, userSessions } from "@/features/admin/queries";
import { setUserStatus, revokeUserSessions } from "@/features/admin/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tabs, resolveTab } from "@/components/ui/Tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ResetPasswordPanel, UserForm } from "@/features/admin/components/forms";
import { AccessMatrix } from "@/features/admin/components/matrices";

const TABS = [{ key: "profile", label: "Profile" }, { key: "access", label: "Access" }, { key: "sessions", label: "Sessions" }, { key: "activity", label: "Activity" }];

export default async function UserDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage("users");
  const { id: raw } = await params;
  const id = Number(raw);
  const u = Number.isInteger(id) ? getUserRow(id) : undefined;
  if (!u) notFound();
  const tab = resolveTab(await searchParams, TABS);
  const isSuper = u.role_code === "super_admin";
  const protectedTarget = isSuper && !me.isSuperAdmin;
  const canEdit = can(me, "users", "edit") && !protectedTarget;
  const canDisable = can(me, "users", "disable") && !protectedTarget && u.id !== me.id;
  const lk = lookups();
  const locked = u.status === "locked" && parseDbDate(u.locked_until) > Date.now();
  const base = `/admin/users/${u.id}`;
  return (
    <>
      <PageHeader title={u.name} description={`${u.email ?? ""} · ${u.role_name ?? u.role}`} breadcrumbs={[{ label: "Users", href: "/admin/users" }, { label: u.name }]}
        badges={<>{u.status === "disabled" ? <Badge tone="slate">Disabled</Badge> : locked ? <Badge tone="red">Locked</Badge> : <Badge tone="emerald">Active</Badge>}{u.must_change_password ? <Badge tone="amber">Must change password</Badge> : null}</>} />
      <Tabs tabs={TABS} active={tab} basePath={base} />

      {tab === "profile" && (
        <div className="space-y-5">
          <CardSection title="Profile">
            {canEdit
              ? <UserForm mode="edit" values={{ id: u.id, name: u.name, email: u.email, department_id: u.department_id, role_id: u.role_id, job_title: u.job_title, phone: u.phone, manager_id: u.manager_id, entity_ids: userEntityAccess(u.id).ids, default_entity_id: userEntityAccess(u.id).defaultId }} entities={lk.entities.map((e) => ({ id: e.id, label: e.country, flag: e.flag }))} departments={lk.departments.map((d) => ({ value: d.id, label: d.name }))}
                  roles={lk.roles.filter((r) => r.code !== "super_admin" || me.isSuperAdmin).map((r) => ({ value: r.id, label: r.name }))} users={lk.users.map((x) => ({ value: x.id, label: x.name }))} />
              : <p className="text-sm text-slate-500">You do not have permission to edit this user.</p>}
          </CardSection>
          <CardSection title="Account status" subtitle={`Last login: ${u.last_login_at ? formatDateTime(u.last_login_at) : "never"} · failed attempts: ${u.failed_attempts ?? 0}`}>
            <div className="flex flex-wrap gap-2">
              {canDisable && u.status !== "disabled" && <form action={setUserStatus}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="disable" /><Button type="submit" variant="danger">Disable account</Button></form>}
              {can(me, "users", "disable") && !protectedTarget && u.status === "disabled" && <form action={setUserStatus}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="enable" /><Button type="submit" variant="success">Enable account</Button></form>}
              {can(me, "users", "disable") && !protectedTarget && (locked || u.status === "locked") && <form action={setUserStatus}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="op" value="unlock" /><Button type="submit">Unlock</Button></form>}
              {u.id === me.id && <span className="text-xs text-slate-500">You cannot disable your own account.</span>}
            </div>
          </CardSection>
          {can(me, "users", "reset_password") && !protectedTarget && <CardSection title="Reset password"><ResetPasswordPanel userId={u.id} /></CardSection>}
        </div>
      )}

      {tab === "access" && (
        <AccessMatrix userId={u.id} roleKeys={rolePermissionKeys(u.role_id ?? 0)} initial={userOverrides(u.id)} isSuperAdmin={isSuper}
          readOnly={!canEdit || (u.id === me.id && !me.isSuperAdmin)} />
      )}

      {tab === "sessions" && <SessionsTab userId={u.id} canEdit={canEdit} currentSessionId={(await getSession())?.sessionId} />}

      {tab === "activity" && (
        <CardSection title="Recent activity" subtitle="Sign-in events and changes made by this user." flush>
          <Table>
            <THead><TR><TH>When</TH><TH>Type</TH><TH>Event</TH><TH>Detail</TH></TR></THead>
            <TBody>
              {listAudit({ user: String(u.id), limit: 100 }).map((e, i) => (
                <TR key={i}><TD className="whitespace-nowrap">{formatDateTime(new Date(e.ts).toISOString())}</TD><TD>{e.source === "auth" ? "Auth" : "Activity"}</TD><TD>{e.event}</TD><TD className="text-slate-500">{e.detail}</TD></TR>
              ))}
            </TBody>
          </Table>
        </CardSection>
      )}
    </>
  );
}

function SessionsTab({ userId, canEdit, currentSessionId }: { userId: number; canEdit: boolean; currentSessionId?: number }) {
  const rows = userSessions(userId);
  const now = Date.now();
  const live = (r: (typeof rows)[number]) => !r.revoked_at && parseDbDate(r.expires_at) > now;
  return (
    <CardSection title="Sessions" flush
      actions={canEdit && rows.some(live) ? <form action={revokeUserSessions}><input type="hidden" name="id" value={userId} /><Button type="submit" size="sm" variant="danger">Revoke all sessions</Button></form> : undefined}>
      <Table>
        <THead><TR><TH>Started</TH><TH>Last active</TH><TH>IP</TH><TH>Device</TH><TH>Status</TH><TH /></TR></THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>{formatDateTime(r.created_at)}</TD><TD>{r.last_seen_at ? formatDateTime(r.last_seen_at) : "—"}</TD><TD>{r.ip ?? "—"}</TD>
              <TD className="max-w-xs truncate" title={r.user_agent ?? ""}>{r.user_agent ?? "—"}</TD>
              <TD>{r.revoked_at ? <Badge tone="slate">Revoked</Badge> : live(r) ? <Badge tone="emerald">Active{r.id === currentSessionId ? " (you)" : ""}</Badge> : <Badge tone="slate">Expired</Badge>}</TD>
              <TD>{canEdit && live(r) && <form action={revokeUserSessions}><input type="hidden" name="id" value={userId} /><input type="hidden" name="session_id" value={r.id} /><Button type="submit" size="sm" variant="danger">Revoke</Button></form>}</TD>
            </TR>
          ))}
          {rows.length === 0 && <TR><TD colSpan={6} className="py-6 text-center text-slate-400">No sessions.</TD></TR>}
        </TBody>
      </Table>
    </CardSection>
  );
}

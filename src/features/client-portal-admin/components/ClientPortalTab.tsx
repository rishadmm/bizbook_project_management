import { Eye, Pencil, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, CardSection, EmptyState, ModalButton, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import ConfirmButton from "@/features/projects/components/ConfirmButton";
import { formatDateTime } from "@/lib/format";
import { getSetting } from "@/lib/db";
import { clientRoleLabel } from "@/lib/client-portal-core";
import { requestOrigin } from "@/lib/portal-auth";
import { deleteClientUser, setClientUserStatus, signOutClientUser, unlockClientUser } from "../actions";
import { getClientEvents, getClientProjectsLite, getClientUsers } from "../queries";
import ClientUrlCard from "./ClientUrlCard";
import { CreateClientUserForm, EditClientUserForm, ResetClientPasswordForm } from "./ClientUserForms";

const EVENT_LABEL: Record<string, string> = {
  login_success: "Signed in", login_failed: "Failed sign-in", locked: "Account locked", logout: "Signed out", password_changed: "Password changed", password_reset: "Password reset",
  user_created: "User created", user_disabled: "User disabled", user_enabled: "User enabled", user_updated: "User updated", user_unlocked: "User unlocked", user_deleted: "User deleted",
  session_revoked: "Sessions signed out", impersonation_started: "Admin view started", impersonation_ended: "Admin view ended", portal_enabled: "Portal enabled", portal_disabled: "Portal disabled",
  slug_changed: "Address changed", settings_changed: "Visibility changed",
};
const EVENT_TONE: Record<string, "green" | "red" | "amber" | "slate" | "violet"> = { login_success: "green", login_failed: "red", locked: "red", user_disabled: "amber", password_reset: "amber", impersonation_started: "violet" };

interface Cli { id: number; name: string; portal_slug: string | null; portal_enabled: number; portal_show_subcontractors: number; portal_show_financials: number }

/** Portal access tab of /clients/[id]: URL card, visibility switches, users, credentials flow, login activity, "open portal as client". */
export default async function ClientPortalTab({ client, canManage, canViewAs }: { client: Cli; canManage: boolean; canViewAs: boolean }) {
  const projects = getClientProjectsLite(client.id);
  const origin = await requestOrigin();
  const tenant = getSetting("company_name", "Al Noor Infrastructure LLC");
  if (projects.length === 0) {
    return (
      <div data-testid="portal-access"><EmptyState title="The client portal needs at least one project" description="Client users see the progress, map and reports of this client's projects. Create or convert a project for this client first, then come back to set up the portal." /></div>
    );
  }
  const users = getClientUsers(client.id);
  const events = getClientEvents(client.id, 20);
  return (
    <div className="space-y-5" data-testid="portal-access">
      <ClientUrlCard clientId={client.id} origin={origin} slug={client.portal_slug ?? ""} enabled={!!client.portal_enabled} showSubs={!!client.portal_show_subcontractors} showFin={!!client.portal_show_financials} canManage={canManage} />

      <CardSection title="Portal users" subtitle={`${users.filter((u) => u.status === "active").length} active of ${users.length}`} flush
        actions={<>
          {canViewAs && client.portal_enabled ? (
            <form method="post" action={`/clients/${client.id}/portal-view`} target="_blank">
              <Button type="submit" size="sm" variant="secondary" data-testid="view-as-client"><Eye size={13} />Open portal as client</Button>
            </form>
          ) : null}
          {canManage && <ModalButton label="Add portal user" title="Add client portal user" variant="primary" size="sm" wide icon={<UserPlus size={14} />}>
            <CreateClientUserForm clientId={client.id} projects={projects} client={client.name} tenant={tenant} />
          </ModalButton>}
        </>}>
        {users.length === 0 ? <div className="p-4"><EmptyState title="No portal users yet" description="Create the first user to give this client read-only access to its project reporting." /></div> : (
          <Table>
            <THead><TR><TH>User</TH><TH>Role</TH><TH>Status</TH><TH>Last login</TH><TH num>Failed</TH><TH>Created</TH><TH>{""}</TH></TR></THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id} data-testid={`portal-user-${u.email}`}>
                  <TD><div className="font-bold text-dark">{u.name}</div><div className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>{u.job_title && <div className="text-xs text-slate-400">{u.job_title}</div>}</TD>
                  <TD>{clientRoleLabel(u.role)}{u.scope && <div className="text-xs text-slate-400">{u.scope.length} project{u.scope.length === 1 ? "" : "s"}</div>}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {u.status === "disabled" ? <Badge tone="slate">Disabled</Badge> : u.locked ? <Badge tone="red">Locked</Badge> : <Badge tone="green">Active</Badge>}
                      {u.must_change_password ? <Badge tone="amber">Must change password</Badge> : null}
                      {u.sessions > 0 && <Badge tone="violet">{u.sessions} session{u.sessions === 1 ? "" : "s"}</Badge>}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap text-xs">{u.last_login_at ? formatDateTime(u.last_login_at) : <span className="text-slate-400">Never</span>}</TD>
                  <TD num>{u.failed_attempts || "—"}</TD>
                  <TD className="text-xs text-slate-500"><div>{u.created_by_name ?? "—"}</div><div>{formatDateTime(u.created_at)}</div></TD>
                  <TD>
                    {canManage && (
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <ModalButton label="Reset password" title={`Reset password · ${u.name}`} variant="ghost" size="sm" icon={<RotateCcw size={13} />}>
                          <ResetClientPasswordForm clientId={client.id} userId={u.id} name={u.name} client={client.name} tenant={tenant} />
                        </ModalButton>
                        <form action={setClientUserStatus}><input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="enable" value={u.status === "active" ? "0" : "1"} />
                          <Button type="submit" size="sm" variant="ghost">{u.status === "active" ? "Disable" : "Enable"}</Button></form>
                        {(u.locked || u.failed_attempts > 0) && <form action={unlockClientUser}><input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="user_id" value={u.id} /><Button type="submit" size="sm" variant="ghost">Unlock</Button></form>}
                        <form action={signOutClientUser}><input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="user_id" value={u.id} /><Button type="submit" size="sm" variant="ghost" title="Sign out all sessions">Sign out all</Button></form>
                        <ModalButton label="" icon={<Pencil size={13} />} title={`Edit ${u.name}`} variant="ghost" size="sm" wide><EditClientUserForm clientId={client.id} user={u} projects={projects} /></ModalButton>
                        {!u.last_login_at && <form action={deleteClientUser}><input type="hidden" name="client_id" value={client.id} /><input type="hidden" name="user_id" value={u.id} /><ConfirmButton message={`Delete portal user ${u.name}?`}><Trash2 size={13} /></ConfirmButton></form>}
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>

      <CardSection title="Login activity" subtitle="Last 20 portal sign-in events for this client" flush>
        {events.length === 0 ? <div className="p-4 text-sm text-slate-400">No activity yet.</div> : (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="portal-events">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                <Badge tone={EVENT_TONE[e.event] ?? "slate"}>{EVENT_LABEL[e.event] ?? e.event}</Badge>
                <span className="font-semibold text-slate-700">{e.user_name ?? e.email ?? "—"}</span>
                {e.detail && <span className="text-xs text-slate-500">{e.detail}</span>}
                <span className="ml-auto whitespace-nowrap text-xs text-slate-400">{e.ip ? `${e.ip} · ` : ""}{formatDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardSection>
    </div>
  );
}

import { AlertTriangle, Eye, Pencil, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { Badge, Button, CardSection, EmptyState, ModalButton, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import ConfirmButton from "@/features/projects/components/ConfirmButton";
import { formatDateTime } from "@/lib/format";
import { getSetting } from "@/lib/db";
import { portalRoleLabel } from "@/lib/portal-core";
import { requestOrigin } from "@/lib/portal-auth";
import { deletePortalUser, decideChangeRequest, setPortalUserStatus, signOutPortalUser, unlockPortalUser } from "../actions";
import { getChangeRequests, getPortalAssignmentsLite, getPortalEvents, getPortalUsers, pendingDocumentCount } from "../queries";
import PortalUrlCard from "./PortalUrlCard";
import { CreateUserForm, EditUserForm, ResetPasswordForm } from "./UserForms";

const EVENT_LABEL: Record<string, string> = {
  login_success: "Signed in", login_failed: "Failed sign-in", locked: "Account locked", logout: "Signed out", password_changed: "Password changed", password_reset: "Password reset",
  user_created: "User created", user_disabled: "User disabled", user_enabled: "User enabled", user_updated: "User updated", user_unlocked: "User unlocked", user_deleted: "User deleted",
  session_revoked: "Sessions signed out", impersonation_started: "Admin view started", impersonation_ended: "Admin view ended", portal_enabled: "Portal enabled", portal_disabled: "Portal disabled", slug_changed: "Address changed",
};
const EVENT_TONE: Record<string, "green" | "red" | "amber" | "slate" | "violet"> = { login_success: "green", login_failed: "red", locked: "red", user_disabled: "amber", password_reset: "amber", impersonation_started: "violet" };

interface Sub { id: number; name: string; portal_slug: string | null; portal_enabled: number }

/** Portal access tab of /subcontractors/[id]: URL card, users, credentials flow, change requests, login activity, admin view. */
export default async function PortalAccessTab({ sub, canManage, canViewAs }: { sub: Sub; canManage: boolean; canViewAs: boolean }) {
  const users = getPortalUsers(sub.id);
  const events = getPortalEvents(sub.id, 20);
  const requests = getChangeRequests(sub.id);
  const asgs = getPortalAssignmentsLite(sub.id);
  const origin = await requestOrigin();
  const tenant = getSetting("company_name", "Al Noor Infrastructure LLC");
  const pendingDocs = pendingDocumentCount(sub.id);
  const slug = sub.portal_slug ?? "";
  const pendingReq = requests.filter((r) => r.status === "pending");
  return (
    <div className="space-y-5" data-testid="portal-access">
      <PortalUrlCard subId={sub.id} origin={origin} slug={slug} enabled={!!sub.portal_enabled} canManage={canManage} />
      {(pendingDocs > 0 || pendingReq.length > 0) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{pendingReq.length > 0 && `${pendingReq.length} change request${pendingReq.length === 1 ? "" : "s"} waiting for a decision. `}{pendingDocs > 0 && `${pendingDocs} document${pendingDocs === 1 ? "" : "s"} uploaded through the portal waiting for review (Documents tab).`}</span>
        </div>
      )}

      <CardSection title="Portal users" subtitle={`${users.filter((u) => u.status === "active").length} active of ${users.length}`} flush
        actions={<>
          {canViewAs && sub.portal_enabled ? (
            <form method="post" action={`/subcontractors/${sub.id}/portal-view`} target="_blank">
              <Button type="submit" size="sm" variant="secondary" data-testid="view-as-sub"><Eye size={13} />Open portal as subcontractor</Button>
            </form>
          ) : null}
          {canManage && <ModalButton label="Add portal user" title="Add portal user" variant="primary" size="sm" wide icon={<UserPlus size={14} />}>
            <CreateUserForm subId={sub.id} assignments={asgs} company={sub.name} tenant={tenant} />
          </ModalButton>}
        </>}>
        {users.length === 0 ? <div className="p-4"><EmptyState title="No portal users yet" description="Create the first user (usually the company owner) to give this subcontractor access to its portal." /></div> : (
          <Table>
            <THead><TR><TH>User</TH><TH>Role</TH><TH>Status</TH><TH>Last login</TH><TH num>Failed</TH><TH>Created</TH><TH>{""}</TH></TR></THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id} data-testid={`portal-user-${u.email}`}>
                  <TD><div className="font-bold text-dark">{u.name}</div><div className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>{u.job_title && <div className="text-xs text-slate-400">{u.job_title}</div>}</TD>
                  <TD>{portalRoleLabel(u.portal_role)}{u.scope && <div className="text-xs text-slate-400">{u.scope.length} subcontract{u.scope.length === 1 ? "" : "s"}</div>}</TD>
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
                          <ResetPasswordForm subId={sub.id} userId={u.id} name={u.name} company={sub.name} tenant={tenant} />
                        </ModalButton>
                        <form action={setPortalUserStatus}><input type="hidden" name="subcontractor_id" value={sub.id} /><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="enable" value={u.status === "active" ? "0" : "1"} />
                          <Button type="submit" size="sm" variant="ghost">{u.status === "active" ? "Disable" : "Enable"}</Button></form>
                        {(u.locked || u.failed_attempts > 0) && <form action={unlockPortalUser}><input type="hidden" name="subcontractor_id" value={sub.id} /><input type="hidden" name="user_id" value={u.id} /><Button type="submit" size="sm" variant="ghost">Unlock</Button></form>}
                        <form action={signOutPortalUser}><input type="hidden" name="subcontractor_id" value={sub.id} /><input type="hidden" name="user_id" value={u.id} /><Button type="submit" size="sm" variant="ghost" title="Sign out all sessions">Sign out all</Button></form>
                        <ModalButton label="" icon={<Pencil size={13} />} title={`Edit ${u.name}`} variant="ghost" size="sm" wide><EditUserForm subId={sub.id} user={u} assignments={asgs} /></ModalButton>
                        {!u.last_login_at && <form action={deletePortalUser}><input type="hidden" name="subcontractor_id" value={sub.id} /><input type="hidden" name="user_id" value={u.id} /><ConfirmButton message={`Delete portal user ${u.name}?`}><Trash2 size={13} /></ConfirmButton></form>}
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>

      <CardSection title="Change requests" subtitle="Bank-detail and contact changes requested from the portal" flush>
        {requests.length === 0 ? <div className="p-4 text-sm text-slate-400">No change requests.</div> : (
          <Table>
            <THead><TR><TH>Requested</TH><TH>Type</TH><TH>Details</TH><TH>Status</TH><TH>{""}</TH></TR></THead>
            <TBody>
              {requests.map((r) => (
                <TR key={r.id} data-testid={`change-request-${r.id}`}>
                  <TD className="whitespace-nowrap text-xs">{formatDateTime(r.created_at)}<div className="text-slate-500">{r.requested_by_name}</div></TD>
                  <TD>{r.kind === "bank" ? "Bank details" : "Contact details"}</TD>
                  <TD className="text-xs">{Object.entries(r.payload).filter(([, v]) => v).map(([k, v]) => <div key={k}><span className="text-slate-400">{k.replace(/_/g, " ")}:</span> <b>{v}</b></div>)}{r.reason && <div className="mt-1 text-slate-500">Reason: {r.reason}</div>}</TD>
                  <TD><Badge tone={r.status === "pending" ? "amber" : r.status === "approved" ? "green" : "red"}>{r.status}</Badge>{r.decision_note && <div className="mt-1 text-xs text-slate-500">{r.decision_note}</div>}</TD>
                  <TD>
                    {r.status === "pending" && canManage && (
                      <div className="flex flex-wrap items-center gap-1">
                        <form action={decideChangeRequest}>
                          <input type="hidden" name="subcontractor_id" value={sub.id} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" />
                          <Button type="submit" size="sm" variant="success">Approve</Button>
                        </form>
                        <form action={decideChangeRequest} className="flex items-center gap-1">
                          <input type="hidden" name="subcontractor_id" value={sub.id} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" />
                          <input name="note" placeholder="Reason (optional)" className="w-32 rounded-lg border border-line px-2 py-1 text-xs" aria-label="Decision note" />
                          <Button type="submit" size="sm" variant="danger">Reject</Button>
                        </form>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardSection>

      <CardSection title="Login activity" subtitle="Last 20 portal sign-in events for this company" flush>
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

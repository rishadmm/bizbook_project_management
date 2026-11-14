import { RotateCcw, UserPlus } from "lucide-react";
import { Badge, Button, CardSection, ModalButton, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { getSetting } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getPortalUsers } from "@/features/portal-admin/queries";
import { PORTAL_ROLES, portalRoleLabel } from "@/lib/portal-core";
import { requirePortalUser } from "@/lib/portal-auth";
import { setTeamUserStatus } from "@/features/portal/work-actions";
import { InviteForm, ResetForm } from "@/features/portal/components/TeamForms";

export const metadata = { title: "Team" };

export default async function PortalTeam({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requirePortalUser(slug, "team");
  const users = getPortalUsers(s.sub.id);
  const tenant = getSetting("company_name", "Al Noor Infrastructure LLC");
  return (
    <>
      <PageHeader title="Team" description={`People at ${s.sub.name} with access to this portal.`}
        actions={!s.readOnly ? <ModalButton label="Invite user" title="Invite a team member" variant="primary" wide icon={<UserPlus size={15} />}><InviteForm roles={PORTAL_ROLES.filter((r) => r.value !== "owner").map((r) => ({ value: r.value, label: `${r.label} - ${r.hint}` }))} company={s.sub.name} tenant={tenant} /></ModalButton> : undefined} />
      <CardSection flush>
        <Table>
          <THead><TR><TH>User</TH><TH>Role</TH><TH>Status</TH><TH>Last sign-in</TH><TH>{""}</TH></TR></THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id} data-testid="team-row">
                <TD><div className="font-bold text-dark">{u.name}</div><div className="text-xs text-slate-500">{u.email}</div>{u.job_title && <div className="text-xs text-slate-400">{u.job_title}</div>}</TD>
                <TD>{portalRoleLabel(u.portal_role)}</TD>
                <TD>{u.status === "disabled" ? <Badge tone="slate">Disabled</Badge> : u.locked ? <Badge tone="red">Locked</Badge> : <Badge tone="green">Active</Badge>}{u.must_change_password ? <Badge tone="amber" className="ml-1">Must change password</Badge> : null}</TD>
                <TD className="whitespace-nowrap text-xs">{u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}</TD>
                <TD>
                  {u.portal_role !== "owner" && !s.readOnly && (
                    <div className="flex items-center justify-end gap-1">
                      <ModalButton label="Reset password" title={`Reset password · ${u.name}`} variant="ghost" size="sm" icon={<RotateCcw size={13} />}><ResetForm userId={u.id} name={u.name} company={s.sub.name} tenant={tenant} /></ModalButton>
                      <form action={setTeamUserStatus}><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="enable" value={u.status === "active" ? "0" : "1"} /><Button type="submit" size="sm" variant="ghost">{u.status === "active" ? "Disable" : "Enable"}</Button></form>
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardSection>
    </>
  );
}

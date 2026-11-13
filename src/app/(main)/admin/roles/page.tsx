import Link from "next/link";
import { can, requirePage } from "@/lib/auth";
import { listRoles } from "@/features/admin/queries";
import { deleteRoleAction } from "@/features/admin/actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ModalButton } from "@/components/ui/Modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { CreateRoleForm } from "@/features/admin/components/forms";

export default async function RolesPage() {
  const me = await requirePage("roles");
  const roles = listRoles();
  const canEdit = can(me, "roles", "edit");
  return (
    <>
      <PageHeader title="Roles" description="Define what each role can see and do."
        actions={canEdit ? <ModalButton label="New role" title="New role" variant="primary"><CreateRoleForm roles={roles.map((r) => ({ value: r.id, label: r.name }))} /></ModalButton> : undefined} />
      <CardSection flush>
        <Table>
          <THead><TR><TH>Role</TH><TH>Description</TH><TH>Users</TH><TH>Permissions</TH><TH>Type</TH><TH /></TR></THead>
          <TBody>
            {roles.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/admin/roles/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.name}</Link><div className="text-[11px] text-slate-400">{r.code}</div></TD>
                <TD className="max-w-sm text-slate-500">{r.description ?? "—"}</TD>
                <TD>{r.user_count}</TD><TD>{r.code === "super_admin" ? "All" : r.perm_count}</TD>
                <TD>{r.is_system ? <Badge tone="blue">System</Badge> : <Badge>Custom</Badge>}</TD>
                <TD>
                  <div className="flex justify-end gap-1.5">
                    <Link href={`/admin/roles/${r.id}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">{canEdit && r.code !== "super_admin" ? "Edit" : "View"}</Link>
                    {canEdit && !r.is_system && r.user_count === 0 && <form action={deleteRoleAction}><input type="hidden" name="id" value={r.id} /><Button type="submit" size="sm" variant="danger">Delete</Button></form>}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardSection>
    </>
  );
}

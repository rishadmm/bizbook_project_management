import Link from "next/link";
import { getDb, getSetting } from "@/lib/db";
import { can, requirePage } from "@/lib/auth";
import type { Department, User } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { ModalButton } from "@/components/ui/Modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import ApprovalSettingsForm from "@/features/settings/ApprovalSettingsForm";
import { REGISTRY } from "@/lib/approvals/registry";
import { DOC_TYPES } from "@/lib/approvals/meta";
import { deleteDepartment, saveCompanySettings, saveDepartment } from "@/features/settings/actions";
import ActionForm from "@/components/ActionForm";

type DeptRow = Department & { head_name: string | null; user_count: number };

function DeptForm({ dept, users }: { dept?: DeptRow; users: Pick<User, "id" | "name">[] }) {
  return (
    <ActionForm action={saveDepartment} className="space-y-3">
      {dept && <input type="hidden" name="id" value={dept.id} />}
      <Field label="Name"><Input name="name" required defaultValue={dept?.name} /></Field>
      <Field label="Code"><Input name="code" maxLength={8} defaultValue={dept?.code ?? ""} /></Field>
      <Field label="Department head" hint="Used by approval workflows (department head approver)."><Select name="head_user_id" defaultValue={dept?.head_user_id ?? ""} options={users.map((u) => ({ value: u.id, label: u.name }))} placeholder="—" /></Field>
      <div className="flex justify-end"><Button type="submit" variant="primary">Save</Button></div>
    </ActionForm>
  );
}

export default async function SettingsPage() {
  const me = await requirePage("settings");
  const canEdit = can(me, "settings", "edit");
  const db = getDb();
  const users = db.prepare("SELECT id, name FROM users WHERE status != 'disabled' ORDER BY name").all() as Pick<User, "id" | "name">[];
  const departments = db.prepare(
    `SELECT d.*, h.name AS head_name, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS user_count
     FROM departments d LEFT JOIN users h ON h.id = d.head_user_id ORDER BY d.name`,
  ).all() as DeptRow[];
  return (
    <>
      <PageHeader title="Settings" description="Company profile and departments." />
      <div className="space-y-5">
        <CardSection title="Company">
          <ActionForm action={saveCompanySettings} className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <Field label="Company name"><Input name="company_name" required defaultValue={getSetting("company_name")} disabled={!canEdit} /></Field>
            <Field label="Currency (ISO)"><Input name="currency" required maxLength={3} defaultValue={getSetting("currency", "AED")} disabled={!canEdit} /></Field>
            {canEdit && <Button type="submit" variant="primary">Save</Button>}
          </ActionForm>
        </CardSection>

        <CardSection title="Approvals" subtitle="When approvals are required. Workflows themselves are designed under Administration.">
          <ApprovalSettingsForm canEdit={canEdit} currency={getSetting("currency", "AED")} threshold={getSetting("approval_cost_threshold", "50000")}
            types={DOC_TYPES.map((d) => ({ type: d.type, label: REGISTRY[d.type].label, required: getSetting(`approval_required_${d.type}`, "0") === "1" }))} />
        </CardSection>

        <CardSection title="Users &amp; access" subtitle="Users, roles and permissions are managed in the Administration area.">
          {can(me, "users", "view")
            ? <Link href="/admin/users" className="text-sm font-medium text-blue-700 hover:underline">Manage users →</Link>
            : <span className="text-sm text-slate-500">You do not have access to user administration.</span>}
        </CardSection>

        <CardSection title="Departments" flush
          actions={canEdit ? <ModalButton label="Add department" title="Add department" variant="primary" size="sm"><DeptForm users={users} /></ModalButton> : undefined}>
          <Table>
            <THead><TR><TH>Name</TH><TH>Code</TH><TH>Head</TH><TH>Users</TH><TH className="w-40" /></TR></THead>
            <TBody>
              {departments.map((d) => (
                <TR key={d.id}>
                  <TD className="font-medium text-slate-900">{d.name}</TD><TD>{d.code ?? "—"}</TD><TD>{d.head_name ?? "—"}</TD><TD>{d.user_count}</TD>
                  <TD>
                    {canEdit && (
                      <div className="flex justify-end gap-1.5">
                        <ModalButton label="Edit" title={`Edit ${d.name}`} size="sm"><DeptForm dept={d} users={users} /></ModalButton>
                        <ActionForm action={deleteDepartment}><input type="hidden" name="id" value={d.id} /><Button type="submit" size="sm" variant="danger">Delete</Button></ActionForm>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardSection>
      </div>
    </>
  );
}

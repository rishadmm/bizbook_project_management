import Link from "next/link";
import { getDb, getSetting } from "@/lib/db";
import { listEntities } from "@/lib/entities";
import { listFxRates } from "@/lib/fx";
import { formatDate } from "@/lib/format";
import { can, getActiveEntity, requirePage } from "@/lib/auth";
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
import { addFxRate, deleteDepartment, revalueFxAction, saveCompanySettings, saveDepartment } from "@/features/settings/actions";
import EntityForm from "@/features/settings/components/EntityForm";
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
  const entity = await getActiveEntity();
  const entities = listEntities(true);
  const currencies = db.prepare("SELECT code, name FROM currencies ORDER BY code").all() as { code: string; name: string }[];
  const rates = listFxRates();
  const usage = new Map(entities.map((e) => [e.id, (db.prepare("SELECT (SELECT COUNT(*) FROM projects WHERE entity_id = ?) + (SELECT COUNT(*) FROM tenders WHERE entity_id = ?) c").get(e.id, e.id) as { c: number }).c]));
  const users = db.prepare("SELECT id, name FROM users WHERE status != 'disabled' ORDER BY name").all() as Pick<User, "id" | "name">[];
  const departments = db.prepare(
    `SELECT d.*, h.name AS head_name, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS user_count
     FROM departments d LEFT JOIN users h ON h.id = d.head_user_id ORDER BY d.name`,
  ).all() as DeptRow[];
  return (
    <>
      <PageHeader title="Settings" description="Company, countries, currencies and departments." />
      <div className="space-y-5">
        <CardSection title="Company" subtitle="The group. Country details (legal name, currency, tax) are set per country below.">
          <ActionForm action={saveCompanySettings} className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
            <Field label="Company (group) name"><Input name="company_name" required defaultValue={getSetting("company_name")} disabled={!canEdit} /></Field>
            <Field label="Reporting currency" hint="Every amount also stores its USD equivalent."><Input value={getSetting("reporting_currency", "USD")} readOnly disabled /></Field>
            {canEdit && <Button type="submit" variant="primary">Save</Button>}
          </ActionForm>
        </CardSection>

        <CardSection title="Countries" subtitle="Legal entities / branches the company operates through. Each has its own currency, tax details, document prefix and approval limits." flush>
          <Table>
            <THead><TR><TH>Country</TH><TH>Legal name</TH><TH>Currency</TH><TH>Tax</TH><TH num>VAT</TH><TH>Prefix</TH><TH num>Approval limit</TH><TH>Status</TH><TH className="w-24" /></TR></THead>
            <TBody>
              {entities.map((e) => (
                <TR key={e.id} data-entity={e.code}>
                  <TD className="whitespace-nowrap font-medium text-slate-900"><span aria-hidden className="mr-1.5">{e.flag}</span>{e.country}{e.id === entity.id && <span className="ml-1.5 rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] font-bold text-primary">active</span>}</TD>
                  <TD>{e.legal_name}</TD><TD>{e.currency}</TD><TD className="text-xs">{e.tax_label} {e.tax_no ?? "—"}{e.cr_no ? <div className="text-slate-400">CR {e.cr_no}</div> : null}</TD><TD num>{e.vat_rate}%</TD>
                  <TD>{e.doc_prefix || "—"}</TD><TD num>{e.approval_cost_threshold.toLocaleString("en-US")} {e.currency}</TD><TD>{e.status}</TD>
                  <TD>{canEdit && <ModalButton label="Edit" title={`Edit ${e.country}`} size="sm" wide><EntityForm entity={e} currencies={currencies} locked={(usage.get(e.id) ?? 0) > 0} /></ModalButton>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardSection>

        <CardSection title="Currencies & FX rates" subtitle="Rates are USD per 1 unit. Every money row locks the rate effective on its own date; adding a rate never rewrites history.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <Table>
                <THead><TR><TH>Currency</TH><TH num>USD per unit</TH><TH>Effective</TH><TH>Source</TH></TR></THead>
                <TBody>
                  {rates.map((r) => <TR key={r.id}><TD className="font-medium">{r.currency}</TD><TD num>{r.rate_to_usd.toFixed(6)}</TD><TD>{formatDate(r.effective_date)}</TD><TD className="text-xs text-slate-500">{r.source ?? "—"}</TD></TR>)}
                </TBody>
              </Table>
            </div>
            {canEdit && (
              <div className="space-y-5">
                <ActionForm action={addFxRate} className="grid gap-3 sm:grid-cols-2">
                  <Field label="Currency"><Select name="currency" options={currencies.filter((c) => c.code !== "USD").map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} /></Field>
                  <Field label="USD per 1 unit"><Input name="rate_to_usd" type="number" step="any" min="0" required placeholder="2.600780" /></Field>
                  <Field label="Effective date"><Input name="effective_date" type="date" required /></Field>
                  <Field label="Source"><Input name="source" placeholder="Central bank" /></Field>
                  <div className="sm:col-span-2"><Button type="submit" variant="primary">Add rate</Button></div>
                </ActionForm>
                <ActionForm action={revalueFxAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-3">
                  <Field label="Re-value rows dated from" hint="Audited. Re-computes the locked USD rate of every row on or after the date."><Input name="from_date" type="date" required /></Field>
                  <Button type="submit" variant="secondary">Re-value from date</Button>
                </ActionForm>
              </div>
            )}
          </div>
        </CardSection>

        <CardSection title="Approvals" subtitle="When approvals are required. Workflows themselves are designed under Administration.">
          <ApprovalSettingsForm canEdit={canEdit} currency={entity.currency} threshold={String(entity.approval_cost_threshold)}
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

import Link from "next/link";
import { Copy, Plus } from "lucide-react";
import { Badge, Button, CardSection, EmptyState, LinkButton, PageHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { cloneWorkflowAction, deleteWorkflowAction, setWorkflowActiveAction } from "@/lib/approvals/actions";
import { DOC_TYPES } from "@/lib/approvals/meta";
import { listWorkflows, type WorkflowRow } from "@/lib/approvals/queries";
import { can, requirePage } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import ActionForm from "@/components/ActionForm";

function conditions(w: WorkflowRow): string {
  const c: string[] = [];
  const money = (n: number) => formatMoney(n, { compact: true, currency: w.entity_currency ?? undefined });
  if (w.condition_min_amount !== null && w.condition_max_amount !== null) c.push(`${money(w.condition_min_amount)} to < ${money(w.condition_max_amount)}`);
  else if (w.condition_min_amount !== null) c.push(`amount >= ${money(w.condition_min_amount)}`);
  else if (w.condition_max_amount !== null) c.push(`amount < ${money(w.condition_max_amount)}`);
  if (w.department_name) c.push(`department ${w.department_name}`);
  if (w.condition_project_category) c.push(`category ${w.condition_project_category}`);
  return c.length ? c.join(", ") : "Any document";
}

export default async function ApprovalWorkflowsPage() {
  const me = await requirePage("approval_setup");
  const edit = can(me, "approval_setup", "edit");
  const all = listWorkflows();
  return (
    <>
      <PageHeader title="Approval workflows" description="Design multi-level approval workflows per document type. The engine picks the active workflow whose conditions match, highest priority first; with none it auto-approves."
        actions={edit ? <LinkButton href="/admin/approval-workflows/new" variant="primary"><Plus size={14} />New workflow</LinkButton> : undefined} />
      <div className="space-y-5">
        {DOC_TYPES.map((d) => {
          const rows = all.filter((w) => w.document_type === d.type);
          return (
            <CardSection key={d.type} title={d.label} subtitle={rows.length ? `${rows.length} workflow${rows.length === 1 ? "" : "s"}` : "No workflow: documents of this type are approved automatically"} flush>
              {rows.length === 0 ? <div className="p-4"><EmptyState title="No workflow configured" /></div> : (
                <Table>
                  <THead><TR><TH>Name</TH><TH>Country</TH><TH>Conditions</TH><TH num>Priority</TH><TH num>Levels</TH><TH num>Open</TH><TH>Active</TH><TH /></TR></THead>
                  <TBody>
                    {rows.map((w) => (
                      <TR key={w.id} data-workflow={w.id}>
                        <TD><Link href={`/admin/approval-workflows/${w.id}`} className="font-medium text-blue-700 hover:underline">{w.name}</Link>{w.description && <div className="max-w-md truncate text-xs text-slate-500">{w.description}</div>}</TD>
                        <TD className="whitespace-nowrap text-xs">{w.entity_short ? `${w.entity_flag} ${w.entity_short}` : "All"}</TD>
                        <TD className="text-xs">{conditions(w)}</TD>
                        <TD num>{w.priority}</TD><TD num>{w.level_count}</TD><TD num>{w.open_requests || "-"}</TD>
                        <TD>
                          {edit ? (
                            <ActionForm action={setWorkflowActiveAction}>
                              <input type="hidden" name="id" value={w.id} /><input type="hidden" name="active" value={w.is_active ? "0" : "1"} />
                              <button type="submit" title="Click to toggle" aria-label={`Toggle ${w.name}`}><Badge tone={w.is_active ? "green" : "slate"}>{w.is_active ? "Active" : "Inactive"}</Badge></button>
                            </ActionForm>
                          ) : <Badge tone={w.is_active ? "green" : "slate"}>{w.is_active ? "Active" : "Inactive"}</Badge>}
                        </TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            <LinkButton href={`/admin/approval-workflows/${w.id}`} size="sm" variant="secondary">{edit ? "Edit" : "View"}</LinkButton>
                            {edit && <ActionForm action={cloneWorkflowAction}><input type="hidden" name="id" value={w.id} /><Button type="submit" size="sm" variant="ghost" title="Clone"><Copy size={13} />Clone</Button></ActionForm>}
                            {edit && <ActionForm action={deleteWorkflowAction}><input type="hidden" name="id" value={w.id} /><Button type="submit" size="sm" variant="ghost">Delete</Button></ActionForm>}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardSection>
          );
        })}
      </div>
    </>
  );
}

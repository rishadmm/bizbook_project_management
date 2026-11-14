import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import WorkflowEditor, { type WorkflowInit } from "@/components/approvals/WorkflowEditor";
import type { LevelInput } from "@/lib/approvals/actions";
import { approvalLookups, getWorkflow } from "@/lib/approvals/queries";
import { can, requirePage } from "@/lib/auth";

export default async function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePage("approval_setup");
  const { id: raw } = await params;
  const lookups = approvalLookups();
  let init: WorkflowInit = {
    id: 0, name: "", document_type: "sub_invoice", description: "", priority: 0, is_active: true,
    condition_min_amount: null, condition_max_amount: null, condition_department_id: null, condition_project_category: null,
  };
  let levels: LevelInput[] = [];
  if (raw !== "new") {
    const w = getWorkflow(Number(raw));
    if (!w) notFound();
    const x = w.workflow;
    init = { id: x.id, name: x.name, document_type: x.document_type, description: x.description ?? "", priority: x.priority, is_active: !!x.is_active,
      condition_min_amount: x.condition_min_amount, condition_max_amount: x.condition_max_amount, condition_department_id: x.condition_department_id, condition_project_category: x.condition_project_category };
    levels = w.levels.map((l) => ({
      name: l.name, approver_type: l.approver_type, approver_role_id: l.approver_role_id, approver_user_id: l.approver_user_id, approver_department_id: l.approver_department_id,
      approval_mode: l.approval_mode, min_approvals: l.min_approvals, min_amount: l.min_amount, sla_hours: l.sla_hours, allow_self_approval: !!l.allow_self_approval,
    }));
  }
  return (
    <>
      <PageHeader title={init.id ? init.name : "New approval workflow"} breadcrumbs={[{ label: "Approval workflows", href: "/admin/approval-workflows" }, { label: init.id ? `#${init.id}` : "New" }]}
        description="Changing a workflow affects new requests only; open requests keep the levels they started with." />
      <WorkflowEditor key={init.id} init={init} initialLevels={levels} roles={lookups.roles} users={lookups.users} departments={lookups.departments} canEdit={can(me, "approval_setup", "edit")} />
    </>
  );
}

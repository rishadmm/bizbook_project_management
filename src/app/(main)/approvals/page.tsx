import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge, Button, CardSection, EmptyState, Field, Input, PageHeader, Select, Table, TBody, TD, TH, THead, TR, Tabs, resolveTab } from "@/components/ui";
import { ApprovalStatusBadge } from "@/components/approvals/ApprovalBadge";
import { decideTaskAction, endDelegationAction, setDelegationAction } from "@/lib/approvals/actions";
import { getMyPendingTasks } from "@/lib/approvals/engine";
import { DOC_LABEL, DOC_TYPES } from "@/lib/approvals/meta";
import { approvalLookups, listCompletedFor, listDelegations, listSubmittedBy } from "@/lib/approvals/queries";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney, todayISO } from "@/lib/format";
import ActionForm from "@/components/ActionForm";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePage("approvals");
  const entity = await getActiveEntity();
  const tasks = getMyPendingTasks(me.id, entity.id);
  const tabs = [
    { key: "pending", label: "Pending for me", count: tasks.length }, { key: "submitted", label: "Submitted by me" },
    { key: "completed", label: "Completed" }, { key: "delegations", label: "Delegations" },
  ];
  const tab = resolveTab(await searchParams, tabs, "pending");
  const overdue = tasks.filter((t) => t.overdue).length;
  return (
    <>
      <PageHeader title="Approvals" description="Your approval inbox: documents waiting for your decision, requests you raised, history and out-of-office delegation."
        badges={overdue > 0 ? <Badge tone="red"><AlertTriangle size={11} />{overdue} overdue</Badge> : undefined} />
      <Tabs tabs={tabs} active={tab} basePath="/approvals" />

      {tab === "pending" && (
        <CardSection title="Waiting for my decision" subtitle="Approve, return for changes or reject. A comment is required to return or reject." flush>
          {tasks.length === 0 ? <div className="p-4"><EmptyState title="Nothing to approve" description="Tasks assigned to you (or delegated to you) appear here." /></div> : (
            <Table>
              <THead><TR><TH>Document</TH><TH>Type</TH><TH num>Amount</TH><TH>Level</TH><TH>Requested by</TH><TH>Waiting since</TH><TH>Due</TH><TH>Decision</TH></TR></THead>
              <TBody>
                {tasks.map((t) => (
                  <TR key={t.task_id} className={t.overdue ? "bg-red-50/40" : ""} data-task={t.task_id}>
                    <TD><span title={entity.country} className="mr-1">{t.entity_flag}</span><Link href={t.url} className="font-medium text-blue-700 hover:underline">{t.document_ref ?? `#${t.document_id}`}</Link><div className="max-w-[260px] truncate text-xs text-slate-500">{t.title}</div></TD>
                    <TD className="whitespace-nowrap text-xs">{DOC_LABEL[t.document_type]}</TD>
                    <TD num>{t.amount > 0 ? formatMoney(t.amount, { compact: true }) : "-"}</TD>
                    <TD className="whitespace-nowrap text-xs">L{t.level_no}/{t.level_count} · {t.level_name}{t.delegated_from_name && <div className="text-slate-400">delegated by {t.delegated_from_name}</div>}</TD>
                    <TD className="text-xs">{t.requester_name ?? "-"}</TD>
                    <TD className="whitespace-nowrap text-xs">{formatDateTime(t.created_at)}</TD>
                    <TD className="whitespace-nowrap text-xs">{t.due_at ? formatDateTime(t.due_at) : "-"}{t.overdue && <div><Badge tone="red">Overdue</Badge></div>}</TD>
                    <TD>
                      <ActionForm action={decideTaskAction} className="flex min-w-[330px] flex-wrap items-center gap-1.5">
                        <input type="hidden" name="task_id" value={t.task_id} /><input type="hidden" name="path" value="/approvals" />
                        <Input name="comment" placeholder="Comment" aria-label={`Comment for ${t.document_ref ?? t.document_id}`} className="!py-1.5 !text-xs" required />
                        <Button type="submit" name="decision" value="approve" variant="success" size="sm" formNoValidate>Approve</Button>
                        <Button type="submit" name="decision" value="return" variant="secondary" size="sm">Return</Button>
                        <Button type="submit" name="decision" value="reject" variant="danger" size="sm">Reject</Button>
                      </ActionForm>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardSection>
      )}

      {tab === "submitted" && (() => {
        const rows = listSubmittedBy(me.id, entity.id);
        return (
          <CardSection title="Requests I submitted" flush>
            {rows.length === 0 ? <div className="p-4"><EmptyState title="No requests yet" /></div> : (
              <Table>
                <THead><TR><TH>Document</TH><TH>Type</TH><TH num>Amount</TH><TH>Status</TH><TH>Progress</TH><TH>Waiting on</TH><TH>Submitted</TH></TR></THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD><span title={entity.country} className="mr-1">{r.entity_flag}</span><Link href={r.url} className="font-medium text-blue-700 hover:underline">{r.document_ref ?? `#${r.document_id}`}</Link><div className="max-w-[260px] truncate text-xs text-slate-500">{r.title}</div></TD>
                      <TD className="whitespace-nowrap text-xs">{DOC_LABEL[r.document_type]}</TD>
                      <TD num>{r.amount > 0 ? formatMoney(r.amount, { compact: true }) : "-"}</TD>
                      <TD><ApprovalStatusBadge status={r.status} /></TD>
                      <TD className="whitespace-nowrap text-xs">{r.status === "pending" && r.level_name ? `L${r.current_level}/${r.level_count} · ${r.level_name}` : "-"}</TD>
                      <TD className="text-xs">{r.waiting_on ?? "-"}{r.overdue && <Badge tone="red" className="ml-1">Overdue</Badge>}</TD>
                      <TD className="whitespace-nowrap text-xs">{formatDate(r.requested_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardSection>
        );
      })()}

      {tab === "completed" && (() => {
        const rows = listCompletedFor(me.id, entity.id);
        return (
          <CardSection title="Completed approvals" subtitle="Requests you raised or decided that are no longer open" flush>
            {rows.length === 0 ? <div className="p-4"><EmptyState title="No completed approvals yet" /></div> : (
              <Table>
                <THead><TR><TH>Document</TH><TH>Type</TH><TH num>Amount</TH><TH>Outcome</TH><TH>My decision</TH><TH>Requested by</TH><TH>Completed</TH></TR></THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD><span title={entity.country} className="mr-1">{r.entity_flag}</span><Link href={r.url} className="font-medium text-blue-700 hover:underline">{r.document_ref ?? `#${r.document_id}`}</Link><div className="max-w-[260px] truncate text-xs text-slate-500">{r.title}</div></TD>
                      <TD className="whitespace-nowrap text-xs">{DOC_LABEL[r.document_type]}</TD>
                      <TD num>{r.amount > 0 ? formatMoney(r.amount, { compact: true }) : "-"}</TD>
                      <TD><ApprovalStatusBadge status={r.status} /></TD>
                      <TD className="max-w-[240px] text-xs">{r.my_decision ?? "-"}{r.my_comment && <div className="italic text-slate-500">&ldquo;{r.my_comment}&rdquo;</div>}</TD>
                      <TD className="text-xs">{r.requester_name ?? "-"}</TD>
                      <TD className="whitespace-nowrap text-xs">{formatDate(r.completed_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardSection>
        );
      })()}

      {tab === "delegations" && (() => {
        const { outgoing, incoming } = listDelegations(me.id);
        const users = approvalLookups().users.filter((u) => u.id !== me.id);
        const today = todayISO();
        const state = (d: { is_active: number; start_date: string; end_date: string }) => !d.is_active ? "ended" : d.end_date < today ? "expired" : d.start_date > today ? "scheduled" : "active";
        return (
          <div className="space-y-5">
            <CardSection title="Out of office" subtitle="While a delegation is active, new approval tasks for you are routed to your delegate.">
              <ActionForm action={setDelegationAction} className="grid gap-3 sm:grid-cols-4">
                <Field label="Delegate"><Select name="delegate_user_id" required placeholder="- select user -" options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>
                <Field label="From"><Input name="start_date" type="date" defaultValue={today} required /></Field>
                <Field label="To"><Input name="end_date" type="date" required /></Field>
                <div className="flex items-end"><Button type="submit" variant="primary">Set delegation</Button></div>
                <fieldset className="sm:col-span-4">
                  <legend className="mb-1 text-xs font-bold text-slate-600">Document types (none selected = all)</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                    {DOC_TYPES.map((d) => <label key={d.type} className="flex items-center gap-1"><input type="checkbox" name="document_types" value={d.type} />{d.label}</label>)}
                  </div>
                </fieldset>
              </ActionForm>
            </CardSection>
            <CardSection title="My delegations" flush>
              {outgoing.length === 0 ? <div className="p-4"><EmptyState title="No delegations" /></div> : (
                <Table>
                  <THead><TR><TH>Delegate</TH><TH>From</TH><TH>To</TH><TH>Types</TH><TH>State</TH><TH /></TR></THead>
                  <TBody>
                    {outgoing.map((d) => (
                      <TR key={d.id}><TD className="font-medium">{d.delegate_name}</TD><TD>{formatDate(d.start_date)}</TD><TD>{formatDate(d.end_date)}</TD>
                        <TD className="max-w-[300px] text-xs">{d.document_types ? d.document_types.split(",").map((t) => DOC_LABEL[t] ?? t).join(", ") : "All"}</TD>
                        <TD><Badge tone={state(d) === "active" ? "green" : state(d) === "scheduled" ? "blue" : "slate"}>{state(d)}</Badge></TD>
                        <TD>{d.is_active ? <ActionForm action={endDelegationAction}><input type="hidden" name="id" value={d.id} /><Button type="submit" size="sm" variant="ghost">End</Button></ActionForm> : null}</TD></TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardSection>
            {incoming.length > 0 && (
              <CardSection title="Delegated to me" flush>
                <Table>
                  <THead><TR><TH>From</TH><TH>Period</TH><TH>Types</TH><TH>State</TH></TR></THead>
                  <TBody>
                    {incoming.map((d) => (
                      <TR key={d.id}><TD className="font-medium">{d.user_name}</TD><TD>{formatDate(d.start_date)} - {formatDate(d.end_date)}</TD>
                        <TD className="max-w-[300px] text-xs">{d.document_types ? d.document_types.split(",").map((t) => DOC_LABEL[t] ?? t).join(", ") : "All"}</TD>
                        <TD><Badge tone={state(d) === "active" ? "green" : "slate"}>{state(d)}</Badge></TD></TR>
                    ))}
                  </TBody>
                </Table>
              </CardSection>
            )}
          </div>
        );
      })()}
    </>
  );
}

import { AlertTriangle, Check, CircleDot, CornerUpLeft, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CardSection } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Field";
import { ModalButton } from "@/components/ui/Modal";
import { cancelApprovalAction, decideTaskAction, submitApprovalAction } from "@/lib/approvals/actions";
import { getAnyPendingTask, getApprovalStatus, getMyTaskFor, type LevelStatus } from "@/lib/approvals/engine";
import { DOC_LABEL } from "@/lib/approvals/meta";
import { REGISTRY } from "@/lib/approvals/registry";
import type { AuthUser } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ApprovalDocType } from "@/lib/types";
import { ApprovalStatusBadge, TaskStatusBadge } from "./ApprovalBadge";
import ActionForm from "@/components/ActionForm";

const EVENT_LABEL: Record<string, string> = {
  submitted: "Submitted for approval", level_started: "Level started", level_completed: "Level completed", approved: "Approved", approved_on_behalf: "Approved (on behalf)",
  rejected: "Rejected", rejected_on_behalf: "Rejected (on behalf)", returned: "Returned for changes", returned_on_behalf: "Returned (on behalf)",
  cancelled: "Cancelled", auto_approved: "Auto-approved", delegated: "Delegated", escalated: "Escalated",
};

function Step({ s, index }: { s: LevelStatus; index: number }) {
  const ring = s.state === "done" ? "bg-emerald-500 text-white" : s.state === "current" ? "bg-blue-600 text-white ring-4 ring-blue-100" : s.state === "rejected" ? "bg-red-600 text-white" : s.state === "returned" ? "bg-orange-500 text-white" : "bg-slate-200 text-slate-500";
  return (
    <li className="min-w-[170px] flex-1 rounded-lg border border-slate-200 bg-white p-3" data-level={s.level.level_no} data-state={s.state}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${ring}`}>
          {s.state === "done" ? <Check size={13} /> : s.state === "rejected" ? <X size={13} /> : s.state === "returned" ? <CornerUpLeft size={13} /> : index + 1}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">Level {s.level.level_no} · {s.level.name}</div>
          <div className="truncate text-[11px] text-slate-500">{s.level.label}{s.level.approval_mode !== "any" ? ` · ${s.level.approval_mode === "all" ? "all must approve" : `min ${s.level.min_approvals}`}` : ""}</div>
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        {s.tasks.length === 0 && <li className="text-[11px] text-slate-400">{s.state === "upcoming" ? "Not started" : "-"}</li>}
        {s.tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-1 text-xs text-slate-700">
            <span className="font-medium">{t.assignee_name}</span>
            {t.delegated_from_name && <span className="text-[10px] text-slate-400">(for {t.delegated_from_name})</span>}
            <TaskStatusBadge status={t.status} />
            {t.overdue && <Badge tone="red"><AlertTriangle size={10} />Overdue</Badge>}
            {t.decided_at && <span className="text-[10px] text-slate-400">{formatDateTime(t.decided_at)}</span>}
            {t.decided_by && t.decided_by !== t.assignee_user_id && <span className="text-[10px] text-slate-400">by {t.decided_by_name} on behalf</span>}
            {t.decision_comment && <div className="w-full rounded bg-slate-50 px-2 py-1 text-[11px] italic text-slate-600">&ldquo;{t.decision_comment}&rdquo;</div>}
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Approval panel for any document (AUTH_SPEC section D). Server component: shows the current request, the level stepper, the history
 * and the decision form for the signed-in assignee (a super administrator can approve on behalf). `path` = page to refresh after actions.
 * `canSubmit` is a cosmetic flag (the submit action re-checks the permission). `compact` renders a button that opens the panel in a modal.
 */
export async function ApprovalPanel({ type, documentId, path, user, canSubmit = false, title, compact = false, submitLabel, label }: {
  type: ApprovalDocType; documentId: number; path: string; user: AuthUser; canSubmit?: boolean; title?: string; compact?: boolean; submitLabel?: string; label?: string;
}) {
  const st = getApprovalStatus(type, documentId);
  const entry = REGISTRY[type];
  const blocker = entry.canSubmit?.(documentId) ?? null;
  const open = st?.request.status === "pending";
  const mine = open ? getMyTaskFor(user.id, type, documentId) : undefined;
  const behalf = open && !mine && user.isSuperAdmin ? getAnyPendingTask(type, documentId) : undefined;
  const task = mine ?? behalf;
  const submittable = canSubmit && !open && !blocker;
  const canCancel = open && st && (st.request.requested_by === user.id || user.isSuperAdmin || user.roleCode === "admin");
  if (compact && !st && !submittable) return null;

  const heading = title ?? `${DOC_LABEL[type]} approval`;
  const body = (
    <div className="space-y-4" data-approval-panel={type}>
      {!st && (
        <p className="text-sm text-slate-600">{submittable ? "This document has not been submitted for approval yet." : blocker ?? "No approval has been requested for this document."}</p>
      )}
      {st && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ApprovalStatusBadge status={st.request.status} />
            <span className="text-slate-600">{st.request.document_ref}</span>
            {st.request.amount > 0 && <span className="font-medium text-slate-800">{formatMoney(st.request.amount)}</span>}
            <span className="text-xs text-slate-500">requested by {st.requesterName ?? "-"} on {formatDateTime(st.request.requested_at)}{st.workflowName ? ` · ${st.workflowName}` : ""}</span>
          </div>
          {st.levels.length > 0 ? (
            <ol className="flex flex-wrap gap-2">{st.levels.map((s, i) => <Step key={s.level.level_no} s={s} index={i} />)}</ol>
          ) : <p className="text-xs text-slate-500">No approval level applied; the request was approved automatically.</p>}
        </>
      )}

      {task && (
        <ActionForm action={decideTaskAction} className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <input type="hidden" name="task_id" value={task.id} /><input type="hidden" name="path" value={path} />
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><CircleDot size={14} className="text-blue-600" />
            {mine ? "Your decision is required" : `Approve on behalf of ${behalf?.assignee_name} (super administrator)`}</div>
          <Textarea name="comment" rows={2} placeholder="Comment (required to return or reject)" aria-label="Decision comment" required />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="decision" value="approve" variant="success" size="sm" formNoValidate>Approve</Button>
            <Button type="submit" name="decision" value="return" variant="secondary" size="sm">Return</Button>
            <Button type="submit" name="decision" value="reject" variant="danger" size="sm">Reject</Button>
          </div>
        </ActionForm>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {submittable && (
          <ActionForm action={submitApprovalAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="type" value={type} /><input type="hidden" name="id" value={documentId} /><input type="hidden" name="path" value={path} />
            <Input name="note" placeholder="Note for approvers (optional)" aria-label="Approval note" className="!w-64" />
            <Button type="submit" variant="primary" size="sm">{submitLabel ?? (st && st.request.status !== "approved" ? "Resubmit for approval" : "Submit for approval")}</Button>
          </ActionForm>
        )}
        {canCancel && st && (
          <ActionForm action={cancelApprovalAction}><input type="hidden" name="request_id" value={st.request.id} /><input type="hidden" name="path" value={path} /><Button type="submit" variant="ghost" size="sm">Cancel request</Button></ActionForm>
        )}
      </div>

      {st && st.events.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-slate-600">History ({st.events.length})</summary>
          <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-3">
            {st.events.map((e) => (
              <li key={e.id} className="text-slate-600">
                <span className="text-slate-400">{formatDateTime(e.created_at)}</span> · <b>{EVENT_LABEL[e.event] ?? e.event}</b>{e.level_no ? ` (L${e.level_no})` : ""}{e.user_name ? ` · ${e.user_name}` : ""}
                {e.comment && <span className="italic"> - &ldquo;{e.comment}&rdquo;</span>}
              </li>
            ))}
          </ul>
          {st.previous.length > 0 && (
            <div className="mt-2 text-slate-500">Earlier request{st.previous.length === 1 ? "" : "s"}:
              <ul className="ml-4 list-disc">
                {st.previous.map((p) => <li key={p.id}>{formatDateTime(p.requested_at)} · {p.status}{p.decider ? ` by ${p.decider}` : ""}{p.comment && <span className="italic"> - &ldquo;{p.comment}&rdquo;</span>}</li>)}
              </ul>
            </div>
          )}
        </details>
      )}
    </div>
  );

  if (compact) {
    const lvl = st && open ? st.levels.find((l) => l.level.level_no === st.request.current_level) : undefined;
    const short = label ?? "Approval";
    const text = !st ? `Submit ${short.toLowerCase()}` : open ? `${short}: ${lvl ? `L${st.levels.indexOf(lvl) + 1}/${st.levels.length}` : "pending"}` : `${short}: ${st.request.status}`;
    return <ModalButton label={text} title={heading} size="sm" variant={task ? "primary" : "secondary"} wide>{body}</ModalButton>;
  }
  return <CardSection title={heading} subtitle={entry.label}>{body}</CardSection>;
}

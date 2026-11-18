import ActionForm from "@/components/ActionForm";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { GRADES } from "@/lib/registration";
import { addDays, todayISO } from "@/lib/format";
import { approveRegistration, referBackRegistration, rejectRegistration, reopenRegistration, setRegistrationItem, startRegistrationReview } from "../review-actions";
import type { CategoryRow, ItemRow } from "../core";
import VerdictButtons from "./VerdictButtons";

/** Accept / Query (comment) of one section or document. */
export function ItemVerdictForm({ subId, kind, refKey, item, enabled }: { subId: number; kind: "section" | "document"; refKey: string; item?: ItemRow; enabled: boolean }) {
  if (!enabled) return null;
  return (
    <ActionForm action={setRegistrationItem} className="mt-2 flex flex-wrap items-center gap-2" onlyError>
      <input type="hidden" name="id" value={subId} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="ref" value={refKey} />
      <input name="comment" defaultValue={item?.status === "query" ? item.comment ?? "" : ""} placeholder="Comment (required to query)" aria-label="Reviewer comment" data-testid={`comment-${refKey}`}
        className="min-w-[10rem] flex-1 rounded-lg border-[1.5px] border-[#e2e8f0] px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15" />
      <VerdictButtons refKey={refKey} current={item?.status} />
    </ActionForm>
  );
}

export function StartReviewButton({ subId }: { subId: number }) {
  return (
    <ActionForm action={startRegistrationReview}>
      <input type="hidden" name="id" value={subId} />
      <Button type="submit" variant="primary" data-testid="start-review">Start review</Button>
    </ActionForm>
  );
}

export function ReferBackForm({ subId, queried }: { subId: number; queried: { label: string; comment: string | null }[] }) {
  return (
    <ActionForm action={referBackRegistration} className="space-y-3" errorClassName="text-xs font-semibold text-red-600">
      <input type="hidden" name="id" value={subId} />
      <div>
        <div className="mb-1 text-xs font-bold text-slate-600">Queried items ({queried.length})</div>
        {queried.length === 0 ? <p className="text-xs text-slate-400">None yet. Query a section or a document on the left, or write a note.</p> : (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-700" data-testid="queried-items">{queried.map((q, i) => <li key={i}><strong>{q.label}</strong>{q.comment ? ` — ${q.comment}` : ""}</li>)}</ul>
        )}
      </div>
      <Field label="Note to the supplier"><Textarea name="note" rows={3} placeholder="What needs to be corrected?" data-testid="refer-note" /></Field>
      <Button type="submit" variant="secondary" data-testid="refer-back">Refer back</Button>
    </ActionForm>
  );
}

export function ApproveForm({ subId, categories, gradeHint }: { subId: number; categories: CategoryRow[]; gradeHint?: string | null }) {
  const requested = categories.filter((c) => c.status !== "declined");
  return (
    <ActionForm action={approveRegistration} className="space-y-3" errorClassName="text-xs font-semibold text-red-600">
      <input type="hidden" name="id" value={subId} />
      <fieldset><legend className="mb-1 text-xs font-bold text-slate-600">Approved categories</legend>
        <div className="space-y-1">{requested.map((c) => <label key={c.category_id} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" name="category" value={c.category_id} defaultChecked className="h-4 w-4 accent-[#635bff]" />{c.name}</label>)}</div></fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prequalification grade"><Select name="grade" defaultValue={gradeHint ?? "B"} options={GRADES.map((g) => ({ value: g.value, label: g.label.split(" - ")[0] }))} data-testid="grade" /></Field>
        <Field label="Valid until"><Input name="valid_until" type="date" defaultValue={addDays(todayISO(), 365)} /></Field>
      </div>
      <Field label="Note (optional)"><Input name="note" /></Field>
      <Button type="submit" variant="success" data-testid="approve-registration">Approve registration</Button>
    </ActionForm>
  );
}

export function RejectForm({ subId }: { subId: number }) {
  return (
    <ActionForm action={rejectRegistration} className="space-y-3" errorClassName="text-xs font-semibold text-red-600">
      <input type="hidden" name="id" value={subId} />
      <Field label="Reason (required)"><Textarea name="reason" rows={2} data-testid="reject-reason" /></Field>
      <Button type="submit" variant="danger" data-testid="reject-registration">Reject registration</Button>
    </ActionForm>
  );
}

export function ReopenForm({ subId }: { subId: number }) {
  return (
    <ActionForm action={reopenRegistration} className="space-y-3" errorClassName="text-xs font-semibold text-red-600">
      <input type="hidden" name="id" value={subId} />
      <Field label="Note to the supplier (optional)"><Input name="note" placeholder="Reopened: please correct and resubmit" /></Field>
      <Button type="submit" variant="secondary" data-testid="reopen-registration">Reopen registration</Button>
    </ActionForm>
  );
}

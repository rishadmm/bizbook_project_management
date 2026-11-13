import { Button } from "@/components/ui/Button";
import { CardSection } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { ModalButton } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { formatDate } from "@/lib/format";
import type { User } from "@/lib/types";
import { decideReview } from "../actions";
import type { ReviewRow, TenderDetail } from "../queries";

export function ReviewsTab({ tender, reviews, currentUser }: { tender: TenderDetail; reviews: ReviewRow[]; currentUser: User }) {
  const currentRev = tender.current_revision_id;
  const mine = reviews.filter((r) => r.revision_id === currentRev);
  const history = reviews.filter((r) => r.revision_id !== currentRev);
  const canAct = tender.status === "under_review";
  const row = (r: ReviewRow, act: boolean) => {
    const allowed = act && canAct && (["admin", "super_admin"].includes(currentUser.role) || currentUser.department_id === r.department_id);
    return (
      <TR key={r.id}>
        <TD className="font-medium text-slate-900">{r.department_name ?? "-"}</TD><TD>{r.rev_label ?? "-"}</TD>
        <TD><StatusBadge kind="reviewDecision" value={r.decision} /></TD>
        <TD className="max-w-md text-xs">{r.comment ?? "-"}</TD><TD>{r.reviewer_name ?? "-"}</TD><TD>{formatDate(r.decided_at)}</TD>
        <TD className="text-right">
          {allowed && (
            <ModalButton label={r.decision === "pending" ? "Decide" : "Change decision"} title={`${r.department_name} review`} size="sm" variant="primary">
              <form action={decideReview} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                <Field label="Decision"><Select name="decision" defaultValue="approved" options={[{ value: "approved", label: "Approve" }, { value: "changes_requested", label: "Request changes" }, { value: "rejected", label: "Reject" }]} /></Field>
                <Field label="Comment" hint="Required unless approving"><Textarea name="comment" rows={3} defaultValue={r.comment ?? ""} /></Field>
                <div className="flex justify-end"><Button type="submit" variant="primary">Submit decision</Button></div>
              </form>
            </ModalButton>
          )}
        </TD>
      </TR>
    );
  };
  return (
    <div className="space-y-5">
      <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Acting as <b>{currentUser.name}</b>. You can decide only your department&apos;s row{["admin", "super_admin"].includes(currentUser.role) ? " (admins can decide any)" : ""}. All approvals move the tender to <i>Approved</i>; any change request sends it back to <i>In preparation</i>.
      </div>
      <CardSection title="Current revision reviews" flush>
        {mine.length === 0 ? <div className="p-4"><EmptyState title="No reviews yet" description="Send the tender for review from the Overview tab." /></div> : (
          <Table><THead><TR><TH>Department</TH><TH>Rev</TH><TH>Decision</TH><TH>Comment</TH><TH>Reviewer</TH><TH>Date</TH><TH /></TR></THead><TBody>{mine.map((r) => row(r, true))}</TBody></Table>
        )}
      </CardSection>
      {history.length > 0 && <CardSection title="Earlier review rounds" flush><Table><THead><TR><TH>Department</TH><TH>Rev</TH><TH>Decision</TH><TH>Comment</TH><TH>Reviewer</TH><TH>Date</TH><TH /></TR></THead><TBody>{history.map((r) => row(r, false))}</TBody></Table></CardSection>}
    </div>
  );
}

import { CardSection } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { ApprovalPanel } from "@/components/approvals/ApprovalPanel";
import { can, type AuthUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { TenderRevision } from "@/lib/types";
import type { ReviewRow, TenderDetail } from "../queries";

/** Approvals tab: tender submission, current revision (R1+) and award workflows; legacy department reviews stay read-only. */
export function ApprovalsTab({ tender, revision, reviews, me }: { tender: TenderDetail; revision: TenderRevision | null; reviews: ReviewRow[]; me: AuthUser }) {
  const path = `/tenders/${tender.id}?tab=approvals`;
  const open = ["draft", "in_preparation", "under_review", "approved", "submitted", "negotiation"].includes(tender.status);
  return (
    <div className="space-y-5">
      <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Approvals follow the workflows configured in Administration. Sending the tender for review, releasing a price revision and marking it won each raise an approval request; the next step happens only after the last level approves.
      </div>
      <ApprovalPanel type="tender_submission" documentId={tender.id} path={path} user={me} title="Tender submission approval" canSubmit={can(me, "tenders", "submit") && tender.status === "under_review"} />
      {revision && revision.rev_no > 0 && (
        <ApprovalPanel type="tender_revision" documentId={revision.id} path={path} user={me} title={`Revision ${revision.label} approval`} canSubmit={can(me, "tenders", "submit") && open} />
      )}
      {(["submitted", "negotiation", "won"].includes(tender.status)) && (
        <ApprovalPanel type="tender_award" documentId={tender.id} path={path} user={me} title="Award (Mark Won) approval" canSubmit={false} />
      )}
      {reviews.length > 0 && (
        <CardSection title="Legacy department reviews" subtitle="Read-only record of reviews made before approval workflows were introduced" flush>
          <Table>
            <THead><TR><TH>Department</TH><TH>Rev</TH><TH>Decision</TH><TH>Comment</TH><TH>Reviewer</TH><TH>Date</TH></TR></THead>
            <TBody>
              {reviews.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium text-slate-900">{r.department_name ?? "-"}</TD><TD>{r.rev_label ?? "-"}</TD>
                  <TD><StatusBadge kind="reviewDecision" value={r.decision} /></TD>
                  <TD className="max-w-md text-xs">{r.comment ?? "-"}</TD><TD>{r.reviewer_name ?? "-"}</TD><TD>{formatDate(r.decided_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardSection>
      )}
    </div>
  );
}

import { Badge, Button } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { replyToIssue } from "../actions";

interface C { id: number; author_type: string; author_name: string; body: string; created_at: string }

/** Comment thread of an issue / RFI shared with the subcontractor (internal side, with reply form). */
export default function IssueThread({ issueId, awaiting, hasAssignment }: { issueId: number; awaiting: string | null | undefined; hasAssignment: boolean }) {
  const comments = getDb().prepare("SELECT id, author_type, author_name, body, created_at FROM issue_comments WHERE issue_id = ? ORDER BY id").all(issueId) as C[];
  return (
    <div className="space-y-3" data-testid="issue-thread">
      {awaiting === "portal" && <Badge tone="violet">Waiting for the subcontractor</Badge>}
      {awaiting === "internal" && <Badge tone="amber">Waiting for the project team</Badge>}
      {comments.length === 0 ? <p className="text-sm text-slate-400">No comments yet.</p> : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className={c.author_type === "portal" ? "rounded-xl bg-violet-50 p-3" : "rounded-xl bg-primary-50 p-3"}>
              <div className="flex items-center gap-2 text-xs"><b className="text-dark">{c.author_name}</b><Badge tone={c.author_type === "portal" ? "violet" : "blue"}>{c.author_type === "portal" ? "Subcontractor" : "Project team"}</Badge><span className="ml-auto text-slate-400">{formatDateTime(c.created_at)}</span></div>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={replyToIssue} className="space-y-2 border-t border-line pt-3">
        <input type="hidden" name="issue_id" value={issueId} />
        <textarea name="body" rows={3} required placeholder="Reply to the subcontractor…" aria-label="Reply" className="block w-full rounded-xl border-[1.5px] border-[#e2e8f0] px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        {hasAssignment && <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" name="needs_response" defaultChecked />Needs a response from the subcontractor</label>}
        <Button type="submit" variant="primary" size="sm">Post reply</Button>
      </ActionForm>
    </div>
  );
}

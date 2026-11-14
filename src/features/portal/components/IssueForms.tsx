"use client";
import { useRef } from "react";
import { useServerForm } from "@/components/useServerForm";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { postIssueComment, raisePortalIssue, type WorkState } from "../work-actions";

const CATEGORIES = ["Site access", "Design / drawings", "Materials", "Utilities / clash", "Permits / authority", "Safety", "Payment", "Other"].map((c) => ({ value: c, label: c }));

export function RaiseIssueForm({ assignments, defaultAssignment, responsibilities }: { assignments: { value: number; label: string }[]; defaultAssignment?: number; responsibilities: { value: string; label: string }[] }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(raisePortalIssue, undefined);
  return (
    <form onSubmit={onSubmit} data-action-form="" className="grid gap-3 sm:grid-cols-2" data-testid="issue-form">
      <Field label="Type"><Select name="kind" defaultValue="issue" options={[{ value: "issue", label: "Issue (problem on site)" }, { value: "rfi", label: "RFI (request for information)" }]} /></Field>
      <Field label="Subcontract"><Select name="assignment_id" defaultValue={defaultAssignment ?? assignments[0]?.value} options={assignments} required /></Field>
      <Field label="Title" className="sm:col-span-2"><Input name="title" required maxLength={160} /></Field>
      <Field label="Description" className="sm:col-span-2"><Textarea name="description" rows={4} /></Field>
      <Field label="Category"><Select name="category" options={CATEGORIES} placeholder="Select" /></Field>
      <Field label="Who do you think is responsible?"><Select name="responsibility" defaultValue="other" options={responsibilities.filter((r) => r.value !== "none")} /></Field>
      <Field label="Impact (days of delay)"><Input type="number" name="impact_days" min="0" step="any" defaultValue={0} /></Field>
      <Field label="Attachments"><Input type="file" name="files" multiple accept="image/*,.pdf" /></Field>
      {state?.error && <p role="alert" className="text-sm font-semibold text-red-600 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={pending}>{pending ? "Sending…" : "Send to project team"}</Button></div>
    </form>
  );
}

export function CommentForm({ issueId }: { issueId: number }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(async (p, fd) => { const r = await postIssueComment(p, fd); if (r?.ok) ref.current?.reset(); return r; }, undefined);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} onSubmit={onSubmit} data-action-form="" className="space-y-2" data-testid="comment-form">
      <input type="hidden" name="issue_id" value={issueId} />
      <Textarea name="body" rows={3} required placeholder="Write a comment…" aria-label="Comment" />
      {state?.error && <p role="alert" className="text-sm font-semibold text-red-600">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm font-semibold text-emerald-700">{state.ok}</p>}
      <Button type="submit" variant="primary" size="sm" disabled={pending}>{pending ? "Posting…" : "Post comment"}</Button>
    </form>
  );
}

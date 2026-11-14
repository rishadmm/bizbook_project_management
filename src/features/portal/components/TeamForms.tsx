"use client";
import { useServerForm } from "@/components/useServerForm";
import { Button, Field, Input, Select } from "@/components/ui";
import CredentialsCard from "@/features/portal-admin/components/CredentialsCard";
import { invitePortalUser, resetTeamPassword, type WorkState } from "../work-actions";

export function InviteForm({ roles, company, tenant }: { roles: { value: string; label: string }[]; company: string; tenant: string }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(invitePortalUser, undefined);
  if (state?.credentials) return <CredentialsCard cred={state.credentials} company={company} tenant={tenant} />;
  return (
    <form onSubmit={onSubmit} data-action-form="" className="grid gap-3 sm:grid-cols-2" data-testid="invite-form">
      <Field label="Full name"><Input name="name" required /></Field>
      <Field label="E-mail (login)"><Input name="email" type="email" required autoComplete="off" /></Field>
      <Field label="Phone"><Input name="phone" /></Field>
      <Field label="Job title"><Input name="job_title" /></Field>
      <Field label="Role" className="sm:col-span-2"><Select name="portal_role" options={roles} defaultValue="site" /></Field>
      {state?.error && <p role="alert" className="text-sm font-semibold text-red-600 sm:col-span-2">{state.error}</p>}
      <div className="space-y-2 sm:col-span-2"><p className="text-xs text-slate-500">A temporary password is generated and shown once. The user must choose a new one at first sign-in.</p><Button type="submit" variant="primary" disabled={pending}>{pending ? "Creating…" : "Create user"}</Button></div>
    </form>
  );
}

export function ResetForm({ userId, name, company, tenant }: { userId: number; name: string; company: string; tenant: string }) {
  const { state, pending, onSubmit } = useServerForm<WorkState>(resetTeamPassword, undefined);
  if (state?.credentials) return <CredentialsCard cred={state.credentials} company={company} tenant={tenant} />;
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-3">
      <input type="hidden" name="user_id" value={userId} />
      <p className="text-sm text-slate-600">Issue a new temporary password for <b>{name}</b>? Their sessions are signed out and they must choose a new password.</p>
      {state?.error && <p role="alert" className="text-sm font-semibold text-red-600">{state.error}</p>}
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Working…" : "Reset password"}</Button>
    </form>
  );
}

"use client";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useServerForm } from "@/components/useServerForm";
import { Button, Field, Input, Select } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { PORTAL_ROLES } from "@/lib/portal-perms";
import { createPortalUser, resetPortalUserPassword, updatePortalUser } from "../actions";
import type { CredResult } from "../types";
import CredentialsCard from "./CredentialsCard";
import { genTempPassword } from "./genPassword";

type Asg = { id: number; code: string | null; project: string };
const roleOptions = PORTAL_ROLES.map((r) => ({ value: r.value, label: `${r.label} - ${r.hint}` }));

function ScopePicker({ assignments, current }: { assignments: Asg[]; current?: number[] | null }) {
  const [mode, setMode] = useState<"all" | "pick">(current && current.length ? "pick" : "all");
  return (
    <div className="space-y-2 md:col-span-2">
      <div className="text-xs font-bold text-slate-600">Subcontracts this user can see</div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" name="scope_mode" value="all" checked={mode === "all"} onChange={() => setMode("all")} />All of the company&apos;s subcontracts</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="scope_mode" value="pick" checked={mode === "pick"} onChange={() => setMode("pick")} />Only selected</label>
      </div>
      {mode === "pick" && (
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
          {assignments.length === 0 && <span className="text-xs text-slate-400">No subcontracts yet</span>}
          {assignments.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="scope" value={a.id} defaultChecked={!!current?.includes(a.id)} />{a.code ?? `#${a.id}`} <span className="text-xs text-slate-400">{a.project}</span></label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Create a portal user. On success the form is replaced by the one-time credentials card. */
export function CreateUserForm({ subId, assignments, company, tenant }: { subId: number; assignments: Asg[]; company: string; tenant: string }) {
  const { state, pending, onSubmit } = useServerForm<CredResult>(createPortalUser, null);
  const [pw, setPw] = useState(() => genTempPassword());
  if (state?.ok && state.credentials) return <CredentialsCard cred={state.credentials} company={company} tenant={tenant} />;
  return (
    <form onSubmit={onSubmit} data-action-form="" className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="subcontractor_id" value={subId} />
      <Field label="Full name"><Input name="name" required /></Field>
      <Field label="E-mail (login)"><Input name="email" type="email" required autoComplete="off" /></Field>
      <Field label="Phone"><Input name="phone" /></Field>
      <Field label="Job title"><Input name="job_title" placeholder="e.g. Site engineer" /></Field>
      <Field label="Portal role" className="md:col-span-2"><Select name="portal_role" defaultValue="manager" options={roleOptions} /></Field>
      <ScopePicker assignments={assignments} />
      <div className="md:col-span-2">
        <Field label="Temporary password" hint="Auto-generated. You can type your own (min 8 chars, upper + lower case, digit).">
          <div className="flex gap-2">
            <Input name="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="off" className="font-mono" />
            <button type="button" onClick={() => setPw(genTempPassword())} className="inline-flex shrink-0 items-center gap-1 rounded-xl border-[1.5px] border-primary px-3 text-sm font-bold text-primary hover:bg-primary-50"><RefreshCw size={14} />Regenerate</button>
          </div>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 md:col-span-2"><input type="checkbox" name="must_change" defaultChecked />Require a password change at first sign-in</label>
      {state && !state.ok && <p role="alert" className="text-sm font-medium text-red-600 md:col-span-2">{state.error}</p>}
      <div className="md:col-span-2"><Button type="submit" variant="primary" disabled={pending}>{pending ? "Creating…" : "Create user"}</Button></div>
    </form>
  );
}

export function EditUserForm({ subId, user, assignments }: { subId: number; user: { id: number; name: string; phone: string | null; job_title: string | null; portal_role: string; scope: number[] | null }; assignments: Asg[] }) {
  return (
    <ActionForm action={updatePortalUser} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="subcontractor_id" value={subId} /><input type="hidden" name="user_id" value={user.id} />
      <Field label="Full name"><Input name="name" required defaultValue={user.name} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={user.phone ?? ""} /></Field>
      <Field label="Job title"><Input name="job_title" defaultValue={user.job_title ?? ""} /></Field>
      <Field label="Portal role"><Select name="portal_role" defaultValue={user.portal_role} options={roleOptions} /></Field>
      <ScopePicker assignments={assignments} current={user.scope} />
      <div className="md:col-span-2"><Button type="submit" variant="primary">Save changes</Button></div>
    </ActionForm>
  );
}

/** Issues a new temporary password and shows it once. */
export function ResetPasswordForm({ subId, userId, name, company, tenant }: { subId: number; userId: number; name: string; company: string; tenant: string }) {
  const { state, pending, onSubmit } = useServerForm<CredResult>(resetPortalUserPassword, null);
  if (state?.ok && state.credentials) return <CredentialsCard cred={state.credentials} company={company} tenant={tenant} />;
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-3">
      <input type="hidden" name="subcontractor_id" value={subId} /><input type="hidden" name="user_id" value={userId} />
      <p className="text-sm text-slate-600">Issue a new temporary password for <b>{name}</b>? Their current password stops working, active sessions are signed out and they must choose a new password at the next sign-in.</p>
      {state && !state.ok && <p role="alert" className="text-sm font-medium text-red-600">{state.error}</p>}
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Resetting…" : "Reset password"}</Button>
    </form>
  );
}

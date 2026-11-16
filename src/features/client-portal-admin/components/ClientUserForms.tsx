"use client";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useServerForm } from "@/components/useServerForm";
import { Button, Field, Input, Select } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import { CLIENT_ROLES } from "@/lib/client-portal-perms";
import CredentialsCard from "@/features/portal-admin/components/CredentialsCard";
import { genTempPassword } from "@/features/portal-admin/components/genPassword";
import type { CredResult } from "@/features/portal-admin/types";
import { createClientUser, resetClientUserPassword, updateClientUser } from "../actions";

type Prj = { id: number; code: string; name: string };
const roleOptions = CLIENT_ROLES.map((r) => ({ value: r.value, label: `${r.label} - ${r.hint}` }));

function ScopePicker({ projects, current }: { projects: Prj[]; current?: number[] | null }) {
  const [mode, setMode] = useState<"all" | "pick">(current && current.length ? "pick" : "all");
  return (
    <div className="space-y-2 md:col-span-2">
      <div className="text-xs font-bold text-slate-600">Projects this user can see</div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="radio" name="scope_mode" value="all" checked={mode === "all"} onChange={() => setMode("all")} />All of the client&apos;s projects</label>
        <label className="flex items-center gap-1.5"><input type="radio" name="scope_mode" value="pick" checked={mode === "pick"} onChange={() => setMode("pick")} />Only selected</label>
      </div>
      {mode === "pick" && (
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
          {projects.length === 0 && <span className="text-xs text-slate-400">No projects yet</span>}
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="scope" value={p.id} defaultChecked={!!current?.includes(p.id)} />{p.code} <span className="truncate text-xs text-slate-400">{p.name}</span></label>
          ))}
        </div>
      )}
    </div>
  );
}

const CRED = { basePath: "/c", portalLabel: "Client Portal" };

/** Create a client user. On success the form is replaced by the one-time credentials card. */
export function CreateClientUserForm({ clientId, projects, client, tenant }: { clientId: number; projects: Prj[]; client: string; tenant: string }) {
  const { state, pending, onSubmit } = useServerForm<CredResult>(createClientUser, null);
  const [pw, setPw] = useState(() => genTempPassword());
  if (state?.ok && state.credentials) return <CredentialsCard cred={state.credentials} company={client} tenant={tenant} {...CRED} />;
  return (
    <form onSubmit={onSubmit} data-action-form="" className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="client_id" value={clientId} />
      <Field label="Full name"><Input name="name" required /></Field>
      <Field label="E-mail (login)"><Input name="email" type="email" required autoComplete="off" /></Field>
      <Field label="Phone"><Input name="phone" /></Field>
      <Field label="Job title"><Input name="job_title" placeholder="e.g. Project engineer" /></Field>
      <Field label="Portal role" className="md:col-span-2"><Select name="role" defaultValue="viewer" options={roleOptions} /></Field>
      <ScopePicker projects={projects} />
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

export function EditClientUserForm({ clientId, user, projects }: { clientId: number; user: { id: number; name: string; phone: string | null; job_title: string | null; role: string; scope: number[] | null }; projects: Prj[] }) {
  return (
    <ActionForm action={updateClientUser} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="user_id" value={user.id} />
      <Field label="Full name"><Input name="name" required defaultValue={user.name} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={user.phone ?? ""} /></Field>
      <Field label="Job title"><Input name="job_title" defaultValue={user.job_title ?? ""} /></Field>
      <Field label="Portal role"><Select name="role" defaultValue={user.role} options={roleOptions} /></Field>
      <ScopePicker projects={projects} current={user.scope} />
      <div className="md:col-span-2"><Button type="submit" variant="primary">Save changes</Button></div>
    </ActionForm>
  );
}

/** Issues a new temporary password and shows it once. */
export function ResetClientPasswordForm({ clientId, userId, name, client, tenant }: { clientId: number; userId: number; name: string; client: string; tenant: string }) {
  const { state, pending, onSubmit } = useServerForm<CredResult>(resetClientUserPassword, null);
  if (state?.ok && state.credentials) return <CredentialsCard cred={state.credentials} company={client} tenant={tenant} {...CRED} />;
  return (
    <form onSubmit={onSubmit} data-action-form="" className="space-y-3">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="user_id" value={userId} />
      <p className="text-sm text-slate-600">Issue a new temporary password for <b>{name}</b>? Their current password stops working, active sessions are signed out and they must choose a new password at the next sign-in.</p>
      {state && !state.ok && <p role="alert" className="text-sm font-medium text-red-600">{state.error}</p>}
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Resetting…" : "Reset password"}</Button>
    </form>
  );
}

"use client";
import { useActionState, useState } from "react";
import { Copy } from "lucide-react";
import {
  createRoleAction, createUserAction, resetPasswordAction, updateUserAction, type AdminState,
} from "@/features/admin/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";

type Opt = { value: number | string; label: string };
const Msg = ({ s }: { s: AdminState }) => (s?.error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p> : s?.ok ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{s.ok}</p> : null);

/** One-time credential display (temporary password is shown once, never stored in plain text). */
function TempPassword({ email, password }: { email?: string; password: string }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="temp-password-box">
      <div className="mb-1 font-medium text-amber-900">Temporary password (shown once)</div>
      <div className="flex items-center gap-2">
        <code data-testid="temp-password" className="rounded bg-white px-2 py-1 font-mono text-base text-slate-900">{password}</code>
        <button type="button" onClick={() => navigator.clipboard?.writeText(password)} className="rounded p-1 text-slate-500 hover:bg-amber-100" title="Copy"><Copy size={15} /></button>
      </div>
      {email && <div className="mt-1 text-xs text-amber-800">Login: {email}. The user must choose a new password at first sign-in.</div>}
    </div>
  );
}

export interface UserFormValues { id?: number; name?: string; email?: string | null; department_id?: number | null; role_id?: number | null; job_title?: string | null; phone?: string | null; manager_id?: number | null }

export function UserForm({ values, departments, roles, users, mode }: { values?: UserFormValues; departments: Opt[]; roles: Opt[]; users: Opt[]; mode: "create" | "edit" }) {
  const [s, action, pending] = useActionState<AdminState, FormData>(mode === "create" ? createUserAction : updateUserAction, undefined);
  const [generate, setGenerate] = useState(true);
  return (
    <form action={action} className="grid max-w-2xl gap-3 sm:grid-cols-2">
      {values?.id && <input type="hidden" name="id" value={values.id} />}
      <Field label="Full name"><Input name="name" required defaultValue={values?.name} /></Field>
      <Field label="Email (login id)"><Input name="email" type="email" required defaultValue={values?.email ?? ""} /></Field>
      <Field label="Department"><Select name="department_id" defaultValue={values?.department_id ?? ""} options={departments} placeholder="—" /></Field>
      <Field label="Role"><Select name="role_id" required defaultValue={values?.role_id ?? ""} options={roles} placeholder="Select role…" /></Field>
      <Field label="Job title"><Input name="job_title" defaultValue={values?.job_title ?? ""} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={values?.phone ?? ""} /></Field>
      <Field label="Manager" hint="Used by approval workflows (requester manager)."><Select name="manager_id" defaultValue={values?.manager_id ?? ""} options={users.filter((u) => u.value !== values?.id)} placeholder="—" /></Field>
      {mode === "create" && (
        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="generate" checked={generate} onChange={(e) => setGenerate(e.target.checked)} className="h-4 w-4" /> Generate a temporary password</label>
          {!generate && (
            <>
              <Field label="Initial password" hint="At least 8 characters with upper, lower case and a digit."><Input name="password" type="text" autoComplete="off" /></Field>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="must_change" defaultChecked className="h-4 w-4" /> Require password change at first sign-in</label>
            </>
          )}
        </div>
      )}
      <div className="space-y-3 sm:col-span-2">
        <Msg s={s} />
        {s?.tempPassword && <TempPassword email={s.email} password={s.tempPassword} />}
        <Button type="submit" variant="primary" disabled={pending}>{mode === "create" ? "Create user" : "Save changes"}</Button>
      </div>
    </form>
  );
}

export function ResetPasswordPanel({ userId }: { userId: number }) {
  const [s, action, pending] = useActionState<AdminState, FormData>(resetPasswordAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={userId} />
      <p className="text-sm text-slate-600">Generates a temporary password, signs the user out everywhere and forces a change at next sign-in.</p>
      <Msg s={s} />
      {s?.tempPassword && <TempPassword email={s.email} password={s.tempPassword} />}
      <Button type="submit" variant="danger" disabled={pending}>Reset password</Button>
    </form>
  );
}

export function CreateRoleForm({ roles }: { roles: Opt[] }) {
  const [s, action, pending] = useActionState<AdminState, FormData>(createRoleAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <Field label="Role name"><Input name="name" required /></Field>
      <Field label="Description"><Textarea name="description" rows={2} /></Field>
      <Field label="Start from (clone permissions)"><Select name="clone_from" options={roles} placeholder="Blank (dashboard + approvals only)" /></Field>
      <Msg s={s} />
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={pending}>Create role</Button></div>
    </form>
  );
}

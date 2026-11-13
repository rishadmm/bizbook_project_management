"use client";
import { useActionState } from "react";
import { changePassword, updateProfile, type FormState } from "@/features/auth/actions";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

const Msg = ({ s }: { s: FormState }) => (s?.error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p> : s?.ok ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{s.ok}</p> : null);

export function ProfileForm({ name, phone, jobTitle }: { name: string; phone: string; jobTitle: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(updateProfile, undefined);
  return (
    <form action={action} className="grid max-w-xl gap-3 sm:grid-cols-2">
      <Field label="Name" className="sm:col-span-2"><Input name="name" required defaultValue={name} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={phone} /></Field>
      <Field label="Job title"><Input name="job_title" defaultValue={jobTitle} /></Field>
      <div className="space-y-2 sm:col-span-2"><Msg s={s} /><Button type="submit" variant="primary" disabled={pending}>Save profile</Button></div>
    </form>
  );
}

export function PasswordForm() {
  const [s, action, pending] = useActionState<FormState, FormData>(changePassword, undefined);
  return (
    <form action={action} className="max-w-sm space-y-3">
      <Field label="Current password"><Input name="current" type="password" required autoComplete="current-password" /></Field>
      <Field label="New password" hint="At least 8 characters with an uppercase letter, a lowercase letter and a digit."><Input name="next" type="password" required autoComplete="new-password" /></Field>
      <Field label="Confirm new password"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
      <Msg s={s} />
      <Button type="submit" variant="primary" disabled={pending}>Change password</Button>
    </form>
  );
}

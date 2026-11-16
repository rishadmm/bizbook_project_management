"use client";
import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { clientChangePassword, type ClientFormState } from "../auth-actions";

const Msg = ({ s }: { s: ClientFormState }) => (s?.error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{s.error}</p> : s?.ok ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{s.ok}</p> : null);

export function PasswordForm({ disabled }: { disabled?: boolean }) {
  const [s, action, pending] = useActionState<ClientFormState, FormData>(clientChangePassword, undefined);
  return (
    <form action={action} data-readonly-ok="password" className="max-w-sm space-y-3">
      <Field label="Current password"><Input name="current" type="password" required autoComplete="current-password" /></Field>
      <Field label="New password" hint="At least 8 characters with an uppercase letter, a lowercase letter and a digit."><Input name="next" type="password" required autoComplete="new-password" /></Field>
      <Field label="Confirm new password"><Input name="confirm" type="password" required autoComplete="new-password" /></Field>
      <Msg s={s} />
      <Button type="submit" variant="primary" disabled={pending || disabled}>Change password</Button>
    </form>
  );
}

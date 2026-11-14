"use client";
import { useActionState, useEffect, type ReactNode } from "react";
import { useModalClose } from "@/components/ui/Modal";
import type { ActionResult } from "@/lib/action-result";

/**
 * <form> bound to a server action that returns `ActionResult`. Shows `error` inline (role="alert") instead of throwing to the error page.
 * Submitter name/value pairs (e.g. decision buttons) are preserved by React form actions.
 */
export default function ActionForm({ action, className, children, errorClassName, onlyError = false }: {
  action: (form: FormData) => Promise<ActionResult | void>; className?: string; children: ReactNode; errorClassName?: string; onlyError?: boolean;
}) {
  const [state, run] = useActionState<ActionResult | null, FormData>(async (_prev, fd) => (await action(fd)) ?? { ok: true }, null);
  const close = useModalClose();
  useEffect(() => { if (state?.ok) close?.(); }, [state, close]);
  return (
    <form action={run} className={className} data-action-form="">
      {children}
      {state && !state.ok && <p role="alert" className={errorClassName ?? "w-full basis-full text-xs font-medium text-red-600"}>{state.error}</p>}
      {!onlyError && state?.ok && state.message && <p role="status" className="w-full basis-full text-xs font-medium text-emerald-700">{state.message}</p>}
    </form>
  );
}

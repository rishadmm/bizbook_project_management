"use client";
import { useActionState, startTransition, type FormEvent } from "react";

/**
 * useActionState for a server action WITHOUT React's automatic form reset: the form keeps what the user typed when the action returns an error
 * (long forms such as progress updates or invoices must not clear on a validation message). Use `<form onSubmit={onSubmit} data-action-form="">`.
 */
export function useServerForm<S>(action: (prev: Awaited<S>, form: FormData) => Promise<S>, initial: Awaited<S>) {
  const [state, run, pending] = useActionState<S, FormData>(action as (prev: Awaited<S>, form: FormData) => S | Promise<S>, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => run(fd));
  };
  return { state, pending, onSubmit };
}

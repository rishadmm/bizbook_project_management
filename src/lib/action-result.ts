// Shared result type + guard for server actions that should report problems inline instead of throwing to the Next error page.
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Runs a server-action body. Expected failures (validation, approval rules, permissions) come back as `{ ok:false, error }`;
 * Next's control-flow errors (redirect / notFound) are re-thrown so navigation still works.
 */
export async function guard(fn: () => void | string | Promise<void | string>): Promise<ActionResult> {
  try {
    const msg = await fn();
    return typeof msg === "string" ? { ok: true, message: msg } : { ok: true };
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    const m = e instanceof Error ? e.message : "Something went wrong";
    console.error("[action]", m);
    return { ok: false, error: m };
  }
}

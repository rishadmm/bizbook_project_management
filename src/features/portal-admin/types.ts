/** Result of the credential-issuing actions. The temporary password travels only in this response (shown once, never stored in clear). */
export interface IssuedCredentials { name: string; email: string; password: string; slug: string }
export type CredResult = { ok: true; credentials?: IssuedCredentials; message?: string } | { ok: false; error: string } | null;

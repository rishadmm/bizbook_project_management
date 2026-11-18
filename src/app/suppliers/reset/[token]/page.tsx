import Link from "next/link";
import PublicShell from "@/features/supplier-registration/components/PublicShell";
import { ResetForm } from "@/features/supplier-registration/components/ResetForms";
import { getDb } from "@/lib/db";
import { hashToken } from "@/lib/auth";

export const metadata = { title: "Reset your password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = getDb().prepare("SELECT expires_at, used_at FROM portal_password_resets WHERE token_hash = ?").get(hashToken(token)) as { expires_at: string; used_at: string | null } | undefined;
  const valid = !!row && !row.used_at && Date.parse(row.expires_at) > Date.now();
  return (
    <PublicShell active="login">
      <div className="mx-auto w-full max-w-[460px] px-4 py-10 sm:px-6 md:py-16">
        <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">Password help</div>
        <h1 className="mt-2 text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-dark">Choose a <span className="text-primary">new password</span></h1>
        {valid ? (
          <><p className="mb-7 mt-2 text-[15px] text-slate-500">This link works once and expires after two hours.</p><ResetForm token={token} /></>
        ) : (
          <div className="mt-6 space-y-4"><p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800" data-testid="reset-invalid">This reset link is invalid, has expired or was already used.</p>
            <Link href="/suppliers/login?forgot=1" className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-primary-dark">Request a new link</Link></div>
        )}
      </div>
    </PublicShell>
  );
}

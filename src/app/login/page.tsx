import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Info, LifeBuoy } from "lucide-react";
import { getDb } from "@/lib/db";
import { DEMO_ADMIN_PASSWORD } from "@/lib/migrate";
import { verifyPassword } from "@/lib/password";
import { getSession, safeNext } from "@/lib/auth";
import LoginForm from "./LoginForm";

const eyebrow = "text-[12px] font-extrabold uppercase tracking-[.08em] text-primary";
const h1 = "mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-dark";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; forgot?: string }> }) {
  const { next, forgot } = await searchParams;
  const s = await getSession();
  if (s) redirect(s.user.must_change_password ? "/account/password" : safeNext(next));
  if (forgot !== undefined) {
    return (
      <>
        <div className={eyebrow}>Password help</div>
        <h1 className={h1}>Forgot your <span className="text-primary">password</span>?</h1>
        <div className="mt-6 flex gap-3 rounded-2xl border border-line bg-[#f8fafc] p-4 text-sm leading-relaxed text-slate-600">
          <LifeBuoy className="mt-0.5 shrink-0 text-primary" size={20} />
          <p>Password resets are handled by your workspace administrator. Contact them and ask for a password reset — you will get a temporary password and be asked to choose a new one when you sign in.</p>
        </div>
        <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"><ArrowLeft size={14} />Back to sign in</Link>
      </>
    );
  }
  // Demo hint (local demo data only): the seed writes `demo_admin_email`; shown only while that admin still has the published demo password.
  let hint: string | null = null;
  if (process.env.NODE_ENV !== "production") {
    const db = getDb();
    const email = (db.prepare("SELECT value FROM settings WHERE key = 'demo_admin_email'").get() as { value: string } | undefined)?.value;
    const u = email ? db.prepare("SELECT email, password_hash FROM users WHERE lower(email) = lower(?) AND status = 'active'").get(email) as { email: string; password_hash: string | null } | undefined : undefined;
    if (u?.password_hash && verifyPassword(DEMO_ADMIN_PASSWORD, u.password_hash)) hint = `${u.email} / ${DEMO_ADMIN_PASSWORD}`;
  }
  return (
    <>
      <div className={eyebrow}>Your workspace awaits</div>
      <h1 className={h1}>Sign in to BizBook <span className="text-primary">Project</span></h1>
      <p className="mb-7 mt-2 text-[15px] text-slate-500">Pick up right where you left off.</p>
      <LoginForm next={safeNext(next)} />
      {hint && <p data-testid="demo-hint" className="mt-6 flex items-start gap-2 rounded-xl bg-primary-50 px-3.5 py-2.5 text-xs font-semibold text-slate-600"><Info size={14} className="mt-0.5 shrink-0 text-primary" /><span>Demo login: <span className="font-mono text-dark">{hint}</span></span></p>}
    </>
  );
}

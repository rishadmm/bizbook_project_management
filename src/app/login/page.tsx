import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, LifeBuoy } from "lucide-react";
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
  return (
    <>
      <div className={eyebrow}>Your workspace awaits</div>
      <h1 className={h1}>Sign in to BizBook <span className="text-primary">Project</span></h1>
      <p className="mb-7 mt-2 text-[15px] text-slate-500">Pick up right where you left off.</p>
      <LoginForm next={safeNext(next)} />
    </>
  );
}

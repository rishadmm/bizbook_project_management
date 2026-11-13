import { redirect } from "next/navigation";
import { getSession, safeNext } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const s = await getSession();
  if (s) redirect(s.user.must_change_password ? "/account/password" : safeNext(next));
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-slate-900">Sign in</h1>
      <p className="mb-5 text-sm text-slate-500">Use your work email and password.</p>
      <LoginForm next={safeNext(next)} />
    </>
  );
}

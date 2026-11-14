import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isModule, MODULES } from "@/lib/permissions";
import { LinkButton } from "@/components/ui/Button";

/** Shown (via redirect) when a signed-in user opens a module they cannot view. */
export default async function ForbiddenPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  await requireUser();
  const { module } = await searchParams;
  const label = module && isModule(module) ? MODULES[module].label : "this page";
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-card">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-500"><ShieldAlert size={30} /></span>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-dark">Access denied</h1>
      <p className="mt-2 text-sm text-slate-600">You don&apos;t have access to {label}. Contact your administrator.</p>
      <div className="mt-6 flex items-center justify-center gap-3"><LinkButton href="/" variant="primary">Go to dashboard</LinkButton><Link href="/account" className="px-3 py-2 text-sm font-bold text-primary hover:underline">My account</Link></div>
    </div>
  );
}

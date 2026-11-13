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
    <div className="mx-auto mt-16 max-w-md text-center">
      <ShieldAlert className="mx-auto text-amber-500" size={44} />
      <h1 className="mt-3 text-xl font-semibold text-slate-900">Access denied</h1>
      <p className="mt-2 text-sm text-slate-600">You don&apos;t have access to {label}. Contact your administrator.</p>
      <div className="mt-5 flex justify-center gap-2"><LinkButton href="/" variant="primary">Go to dashboard</LinkButton><Link href="/account" className="px-3 py-2 text-sm text-blue-700 hover:underline">My account</Link></div>
    </div>
  );
}

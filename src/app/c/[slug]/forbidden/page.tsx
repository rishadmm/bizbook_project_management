import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireClientUser } from "@/lib/client-portal-auth";

export default async function ClientForbidden({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireClientUser(slug);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-card">
        <ShieldAlert className="mx-auto mb-3 text-amber-500" size={32} />
        <h1 className="text-lg font-extrabold text-dark">You do not have access to this page</h1>
        <p className="mt-2 text-sm text-slate-500">Your portal role does not include it. Contact your project manager if you need more access.</p>
        <Link href={`/c/${slug}`} className="mt-5 inline-block rounded-[10px] bg-primary px-4 py-2 text-sm font-bold text-white">Back to dashboard</Link>
      </div>
    </div>
  );
}

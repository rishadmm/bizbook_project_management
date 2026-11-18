import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requirePortalUser } from "@/lib/portal-auth";

export default async function PortalForbidden({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ restricted?: string }> }) {
  const { slug } = await params;
  const { restricted } = await searchParams;
  await requirePortalUser(slug);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-2xl border border-line bg-white p-8 text-center shadow-card">
        <ShieldAlert className="mx-auto mb-3 text-amber-500" size={32} />
        <h1 className="text-lg font-extrabold text-dark">{restricted ? "Available after approval" : "You do not have access to this page"}</h1>
        <p className="mt-2 text-sm text-slate-500" data-testid="forbidden-reason">{restricted ? "This page opens once your supplier registration has been approved. Until then you can follow your registration, upload documents and manage your account." : "Your portal role does not include it. Ask the owner of your company account if you need more access."}</p>
        <Link href={`/p/${slug}`} className="mt-5 inline-block rounded-[10px] bg-primary px-4 py-2 text-sm font-bold text-white">Back to dashboard</Link>
      </div>
    </div>
  );
}

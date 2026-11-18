import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import PublicShell from "@/features/supplier-registration/components/PublicShell";
import SupplierLoginForm from "@/features/supplier-registration/components/SupplierLoginForm";
import { ForgotForm } from "@/features/supplier-registration/components/ResetForms";
import { getPortalSession } from "@/lib/portal-auth";

export const metadata = { title: "Supplier sign in" };

export default async function SupplierLoginPage({ searchParams }: { searchParams: Promise<{ forgot?: string }> }) {
  const { forgot } = await searchParams;
  const s = await getPortalSession();
  if (s && !s.readOnly) redirect(s.user.mustChange ? `/p/${s.sub.portal_slug}/change-password` : `/p/${s.sub.portal_slug}`);
  return (
    <PublicShell active="login">
      <div className="mx-auto w-full max-w-[460px] px-4 py-10 sm:px-6 md:py-16">
        {forgot !== undefined ? (
          <>
            <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">Password help</div>
            <h1 className="mt-2 text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-dark">Forgot your <span className="text-primary">password</span>?</h1>
            <p className="mb-7 mt-2 text-[15px] text-slate-500">Enter your email and we will send you a link to choose a new password.</p>
            <ForgotForm />
          </>
        ) : (
          <>
            <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">Supplier portal</div>
            <h1 className="mt-2 text-[30px] font-extrabold leading-tight tracking-[-0.02em] text-dark">Sign in to your <span className="text-primary">supplier account</span></h1>
            <p className="mb-7 mt-2 text-[15px] text-slate-500">Follow your registration, manage documents and bid on tenders.</p>
            <SupplierLoginForm />
          </>
        )}
        <Link href="/suppliers" className="mt-8 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-primary"><ArrowLeft size={14} />Back to the supplier home</Link>
      </div>
    </PublicShell>
  );
}

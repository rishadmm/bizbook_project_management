import { redirect } from "next/navigation";
import PublicShell from "@/features/supplier-registration/components/PublicShell";
import RegisterForm from "@/features/supplier-registration/components/RegisterForm";
import WizardProgress from "@/features/supplier-registration/components/WizardProgress";
import { publicCountries } from "@/features/supplier-registration/queries";
import { getPortalSession, isRestricted } from "@/lib/portal-auth";

export const metadata = { title: "Register your company" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const { country } = await searchParams;
  // already signed in with a registration in progress: continue where the supplier left off
  const s = await getPortalSession();
  if (s && isRestricted(s.sub)) redirect(`/p/${s.sub.portal_slug}/registration`);
  const countries = publicCountries();
  const initial = countries.find((c) => c.code === (country ?? "").toUpperCase())?.code ?? "";
  return (
    <PublicShell active="register">
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 md:py-12">
        <div className="mb-6 rounded-2xl border border-line bg-white p-4 shadow-card"><WizardProgress current={1} /></div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-8">
          <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">Supplier registration</div>
          <h1 className="mt-2 text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-dark">Create your <span className="text-primary">supplier account</span></h1>
          <p className="mb-7 mt-2 text-[15px] text-slate-500">It takes about 15 minutes. Each step is saved as you go, so you can sign out and continue later.</p>
          <RegisterForm countries={countries} initial={initial} />
        </div>
      </div>
    </PublicShell>
  );
}

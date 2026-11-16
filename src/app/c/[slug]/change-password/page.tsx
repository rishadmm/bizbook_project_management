import { redirect } from "next/navigation";
import ClientAuthShell from "@/features/client-portal/components/ClientAuthShell";
import { getSetting } from "@/lib/db";
import { requireClientUser } from "@/lib/client-portal-auth";
import ForcedChangeForm from "./Form";

export const metadata = { title: "Choose a new password" };

export default async function ChangePasswordPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await requireClientUser(slug, "view", { allowMustChange: true });
  if (!s.user.mustChange) redirect(`/c/${slug}`);
  return (
    <ClientAuthShell clientName={s.client.name} tenant={getSetting("company_name", "Al Noor Infrastructure LLC")}>
      <div className="text-[12px] font-extrabold uppercase tracking-[.08em] text-primary">First sign-in</div>
      <h1 className="mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-dark">Choose a new <span className="text-primary">password</span></h1>
      <p className="mb-7 mt-2 text-[15px] text-slate-500">Hello {s.user.name}. For your security, replace the temporary password before continuing.</p>
      <ForcedChangeForm />
    </ClientAuthShell>
  );
}

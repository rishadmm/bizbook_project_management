import Link from "next/link";
import { notFound } from "next/navigation";
import { CardSection, PageHeader, StatusBadge } from "@/components/ui";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requirePortalUser } from "@/lib/portal-auth";
import { REGISTRATION_STATUSES, WIZARD_STEPS, isRegistrationStatus } from "@/lib/registration";
import { checklist, completeness, getProfile, isEditable, listSupplierCategories } from "@/features/supplier-registration/core";
import WizardProgress from "@/features/supplier-registration/components/WizardProgress";
import { StepCategories, StepCompany, StepContacts, StepDocuments, StepExperience, StepHse, StepReview } from "@/features/supplier-registration/components/WizardSteps";
import { RegistrationSummary } from "@/features/supplier-registration/components/summary";
import { getDb } from "@/lib/db";

export const metadata = { title: "Registration" };

export default async function PortalRegistration({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ step?: string }> }) {
  const { slug } = await params;
  const { step: rawStep } = await searchParams;
  const s = await requirePortalUser(slug, "registration");
  const p = getProfile(getDb(), s.sub.id);
  if (!p) notFound();
  const st = p.sub.registration_status;
  const editable = isEditable(st) && !s.readOnly;
  const base = `/p/${slug}/registration`;
  const status = isRegistrationStatus(st) ? REGISTRATION_STATUSES[st] : { label: st, tone: "slate" as const };

  // read-only view: submitted / under review / approved / rejected (and the admin view)
  if (!editable) {
    return (
      <>
        <PageHeader title="Registration" description={`${p.sub.registration_no ?? "Not yet submitted"} · ${s.entity.legal_name}`} badges={<Badge tone={status.tone} >{status.label}</Badge>} />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <CardSection title="Your registration" subtitle={st === "approved" ? "Approved suppliers request changes from the Documents page" : "Read only while it is with the procurement team"}>
              <RegistrationSummary p={p} />
              {st === "approved" && <p className="mt-4 text-sm text-slate-500">To change bank or contact details, use <Link href={`/p/${slug}/documents`} className="font-bold text-primary hover:underline">Documents → Company profile → Request change</Link>.</p>}
            </CardSection>
          </div>
          <div className="space-y-5">
            <CardSection title="Review history" subtitle="Every decision on your registration">
              {p.reviews.length === 0 ? <p className="text-sm text-slate-400">No decisions yet.</p> : (
                <ol className="space-y-3" data-testid="review-history">
                  {p.reviews.map((r) => (
                    <li key={r.id} className="border-l-2 border-primary-100 pl-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-extrabold capitalize text-dark">{r.decision.replace("_", " ")}</span><span className="text-xs text-slate-400">{formatDateTime(r.decided_at)}</span></div>
                      {r.note && <p className="text-slate-600">{r.note}</p>}
                      {r.decision === "refer_back" && r.items_json && <ul className="mt-1 list-disc pl-4 text-xs text-slate-500">{(JSON.parse(r.items_json) as { label: string; comment: string | null }[]).map((i, k) => <li key={k}><strong>{i.label}</strong>{i.comment ? ` — ${i.comment}` : ""}</li>)}</ul>}
                    </li>
                  ))}
                </ol>
              )}
            </CardSection>
            <CardSection title="Documents" flush>
              <ul className="divide-y divide-slate-100 text-sm">
                {p.docs.filter((d) => d.doc_type_code).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5"><span className="min-w-0 flex-1 font-semibold text-dark">{p.required.find((r) => r.code === d.doc_type_code)?.name ?? d.doc_type_code}</span><StatusBadge kind="docStatus" value={d.status} />{d.expiry_state === "expired" && <Badge tone="red">Expired</Badge>}{d.expiry_state === "expiring" && <Badge tone="amber">Expires soon</Badge>}</li>
                ))}
              </ul>
              <div className="border-t border-line px-5 py-3 text-xs"><Link href={`/p/${slug}/documents`} className="font-bold text-primary hover:underline">Open Documents</Link></div>
            </CardSection>
          </div>
        </div>
      </>
    );
  }

  // wizard (draft / referred back): first incomplete step by default
  const c = completeness(p);
  const firstOpen = checklist(p).find((x) => !x.ok)?.step ?? 8;
  const requested = Number(rawStep);
  const step = Number.isInteger(requested) && requested >= 2 && requested <= 8 ? requested : st === "referred_back" ? 8 : Math.max(2, firstOpen === 8 && c.ok ? 8 : firstOpen);
  const back = (n: number) => `${base}?step=${n}`;
  const all = listSupplierCategories(getDb(), p.sub.entity_id);
  return (
    <>
      <PageHeader title="Registration" description={`${p.sub.registration_no ?? "Draft"} · ${s.entity.legal_name}`} badges={<Badge tone={status.tone}>{status.label}</Badge>} />
      <div className="mb-5 rounded-2xl border border-line bg-white p-4 shadow-card"><WizardProgress current={step} hrefBase={base} maxStep={8} /></div>
      <CardSection title={`${WIZARD_STEPS[step - 1].label}`} subtitle={step === 8 ? "Check everything, then declare and submit" : "Saved as a draft each time you continue"}>
        {step === 2 && <StepCompany p={p} />}
        {step === 3 && <StepCategories p={p} all={all} back={back(2)} />}
        {step === 4 && <StepContacts p={p} back={back(3)} />}
        {step === 5 && <StepHse p={p} back={back(4)} />}
        {step === 6 && <StepExperience p={p} back={back(5)} />}
        {step === 7 && <StepDocuments p={p} back={back(6)} next={back(8)} canEdit />}
        {step === 8 && <StepReview p={p} back={back(7)} />}
      </CardSection>
    </>
  );
}

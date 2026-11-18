import Link from "next/link";
import { ClipboardCheck, FileText, Lock, UserRound } from "lucide-react";
import { CardSection, PageHeader, Stat } from "@/components/ui";
import { formatDate, todayISO } from "@/lib/format";
import { REGISTRATION_STATUSES, isRegistrationStatus } from "@/lib/registration";
import { completeness, type Profile } from "../core";

/** Dashboard of a supplier whose registration is not approved yet: registration status, completeness and the next steps (A4). */
export default function RestrictedDashboard({ p, slug, userName, canEdit }: { p: Profile; slug: string; userName: string; canEdit: boolean }) {
  const c = completeness(p);
  const st = p.sub.registration_status;
  const label = isRegistrationStatus(st) ? REGISTRATION_STATUSES[st].label : st;
  const docs = p.docs.filter((d) => d.doc_type_code);
  const expiring = docs.filter((d) => d.expiry_state).length;
  return (
    <>
      <PageHeader title={`Welcome, ${userName.split(" ")[0]}`} description={`${p.sub.name} · ${formatDate(todayISO())}`} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="reg-kpis">
        <Stat label="Registration status" value={label} icon={<ClipboardCheck />} tone={st === "rejected" ? "bad" : st === "referred_back" ? "warn" : "default"} />
        <Stat label="Completeness" value={`${c.percent}%`} hint={`${c.done} of ${c.total} items`} tone={c.ok ? "good" : "default"} />
        <Stat label="Documents on file" value={docs.filter((d) => d.attachment_id).length} hint={`${p.required.filter((r) => r.mandatory).length} mandatory`} icon={<FileText />} />
        <Stat label="Expiring / expired" value={expiring} tone={expiring ? "warn" : "default"} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <CardSection title="Next steps" subtitle={c.ok ? "Everything is in place" : `${c.missing.length} item${c.missing.length === 1 ? "" : "s"} still to complete`}>
          {c.ok ? <p className="text-sm text-slate-600">All mandatory information and documents are present.{canEdit && (st === "draft" || st === "referred_back") ? " Review and submit your registration." : ""}</p> : (
            <ul className="space-y-1.5 text-sm">{c.missing.slice(0, 8).map((m) => <li key={m.key}><Link href={`/p/${slug}/registration?step=${m.step}`} className="font-semibold text-primary hover:underline">{m.label}</Link>{m.detail ? <span className="text-slate-400"> · {m.detail}</span> : null}</li>)}{c.missing.length > 8 && <li className="text-slate-400">and {c.missing.length - 8} more…</li>}</ul>
          )}
          {canEdit && <Link href={`/p/${slug}/registration`} className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-bold text-white shadow-brand-sm hover:bg-primary-dark">Open registration</Link>}
        </CardSection>
        <CardSection title="What you can do now" subtitle="Your portal is limited until the registration is approved">
          <ul className="space-y-2.5 text-sm text-slate-600">
            <li className="flex gap-2"><ClipboardCheck size={16} className="mt-0.5 shrink-0 text-primary" />Complete, follow and resubmit your registration.</li>
            <li className="flex gap-2"><FileText size={16} className="mt-0.5 shrink-0 text-primary" />Upload and renew your registration documents.</li>
            <li className="flex gap-2"><UserRound size={16} className="mt-0.5 shrink-0 text-primary" />Manage your account and password.</li>
            <li className="flex gap-2"><Lock size={16} className="mt-0.5 shrink-0 text-slate-400" />Tenders, projects, invoices and payments open after approval.</li>
          </ul>
        </CardSection>
      </div>
    </>
  );
}

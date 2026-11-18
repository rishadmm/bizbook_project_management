import Link from "next/link";
import { AlertTriangle, BadgeCheck, CheckCircle2, Clock, FilePenLine, XCircle } from "lucide-react";
import { hasOpenRequest } from "@/lib/approvals/engine";
import { formatDate } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { completeness, itemLabel, itemStep, type Profile } from "../core";
import { getDb } from "@/lib/db";

const shell = "mb-5 rounded-2xl border px-5 py-4 text-sm";

/** Status banner of the supplier portal (A4): submitted (blue) / action required (amber, with the checklist of queried items) / rejected (red) / approved (green) / draft. */
export default function RegistrationBanner({ p, slug, entityName, includeApproved = false }: { p: Profile; slug: string; entityName: string; includeApproved?: boolean }) {
  const s = p.sub, base = `/p/${slug}/registration`;
  if (s.registration_status === "approved") {
    if (!includeApproved || !s.prequal_grade) return null;
    const cats = p.categories.filter((c) => c.status === "approved").map((c) => c.name);
    return (
      <div role="status" data-testid="reg-banner" data-status="approved" className={cn(shell, "border-emerald-200 bg-emerald-50 text-emerald-900")}>
        <div className="flex items-start gap-2.5"><BadgeCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          <div><strong>Approved</strong> — prequalified grade {s.prequal_grade}{s.prequal_valid_until ? ` until ${formatDate(s.prequal_valid_until)}` : ""}{cats.length ? `, categories: ${cats.join(", ")}` : ""}.</div></div>
      </div>
    );
  }
  if (s.registration_status === "draft") {
    const c = completeness(p);
    return (
      <div role="status" data-testid="reg-banner" data-status="draft" className={cn(shell, "border-slate-200 bg-slate-50 text-slate-800")}>
        <div className="flex flex-wrap items-center gap-2.5"><FilePenLine size={18} className="shrink-0 text-slate-500" /><span><strong>Registration in progress</strong> — {c.percent}% complete. Finish the remaining steps and submit it for review.</span>
          <Link href={base} className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-dark">Continue registration</Link></div>
      </div>
    );
  }
  if (s.registration_status === "submitted" || s.registration_status === "under_review") {
    const waiting = s.registration_status === "under_review" && hasOpenRequest("subcontractor_onboarding", s.id);
    return (
      <div role="status" data-testid="reg-banner" data-status={s.registration_status} className={cn(shell, "border-blue-200 bg-blue-50 text-blue-900")}>
        <div className="flex flex-wrap items-center gap-2.5"><Clock size={18} className="shrink-0 text-blue-600" /><span><strong>Submitted on {formatDate(s.submitted_at?.slice(0, 10))}</strong> — {waiting ? "approval in progress" : "under review"}{s.registration_no ? ` (${s.registration_no})` : ""}.
          You will be notified as soon as there is a decision.</span><Link href={base} className="ml-auto text-xs font-bold text-blue-700 hover:underline">View registration</Link></div>
      </div>
    );
  }
  if (s.registration_status === "rejected") {
    return (
      <div role="alert" data-testid="reg-banner" data-status="rejected" className={cn(shell, "border-red-200 bg-red-50 text-red-900")}>
        <div className="flex items-start gap-2.5"><XCircle size={18} className="mt-0.5 shrink-0 text-red-600" /><div><strong>Rejected</strong> — reason: {s.reject_reason ?? "not stated"}.<div className="mt-1 text-xs text-red-800/80">You cannot resubmit unless {entityName} reopens the registration. Contact the procurement team if you want it reconsidered.</div></div></div>
      </div>
    );
  }
  // referred back: the checklist of queried items
  const items = p.items.filter((i) => i.status === "query" || i.status === "fixed");
  const open = items.filter((i) => i.status === "query").length;
  return (
    <div role="alert" data-testid="reg-banner" data-status="referred_back" className={cn(shell, "border-amber-300 bg-amber-50 text-amber-950")}>
      <div className="flex items-start gap-2.5"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div><strong>Action required</strong> — {entityName} has referred your registration back.</div>
          {s.review_note && <p className="mt-1 italic" data-testid="banner-note">“{s.review_note}”</p>}
          {items.length > 0 && (
            <ul className="mt-2.5 space-y-1.5" data-testid="query-checklist">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-white/70 px-3 py-1.5">
                  {i.status === "fixed" ? <CheckCircle2 size={14} className="self-center text-emerald-600" data-testid="item-fixed" /> : <span className="h-3.5 w-3.5 self-center rounded-full border-2 border-amber-500" />}
                  <Link href={`${base}?step=${itemStep(i)}${i.item_kind === "document" ? `#doc-${i.item_ref}` : ""}`} className="font-bold text-amber-900 underline-offset-2 hover:underline">{itemLabel(getDb(), s.id, i, p.required)}</Link>
                  {i.comment && <span className="text-amber-900/80">— {i.comment}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs font-semibold"><span>{open > 0 ? `${open} item${open === 1 ? "" : "s"} still to change` : "All queried items changed: you can resubmit."}</span>
            <Link href={`${base}?step=8`} className="rounded-lg bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700">Review and resubmit</Link></div>
        </div></div>
    </div>
  );
}

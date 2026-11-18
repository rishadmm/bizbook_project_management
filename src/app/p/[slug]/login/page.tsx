import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Info, LifeBuoy } from "lucide-react";
import AuthShell from "@/features/portal/components/AuthShell";
import { getDb } from "@/lib/db";
import { getEntityById } from "@/lib/entities";
import { safeNext } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { getPortalSession, portalAvailable } from "@/lib/portal-auth";
import { DEMO_PORTAL_PASSWORD, slugError } from "@/lib/portal-core";
import type { Subcontractor } from "@/lib/types";
import PortalLoginForm from "./LoginForm";

const eyebrow = "text-[12px] font-extrabold uppercase tracking-[.08em] text-primary";
const h1 = "mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-dark";

export default async function PortalLoginPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string; forgot?: string }> }) {
  const { slug } = await params;
  const { next, forgot } = await searchParams;
  if (slugError(slug)) notFound();
  const db = getDb();
  const sub = db.prepare("SELECT * FROM subcontractors WHERE portal_slug = ?").get(slug) as Subcontractor | undefined;
  if (!sub) notFound();
  const tenant = getEntityById(sub.entity_id)?.legal_name ?? "";
  const s = await getPortalSession();
  if (s && s.sub.id === sub.id) redirect(s.user.mustChange ? `/p/${slug}/change-password` : `/p/${slug}`);
  const available = portalAvailable(sub);

  if (forgot !== undefined) {
    const pm = db.prepare(`SELECT u.name, u.phone, u.email FROM assignments a JOIN projects p ON p.id = a.project_id JOIN users u ON u.id = p.manager_id
      WHERE a.subcontractor_id = ? AND a.status = 'active' ORDER BY a.id LIMIT 1`).get(sub.id) as { name: string; phone: string | null; email: string | null } | undefined;
    return (
      <AuthShell companyName={sub.name} tenant={tenant}>
        <div className={eyebrow}>Password help</div>
        <h1 className={h1}>Forgot your <span className="text-primary">password</span>?</h1>
        <div className="mt-6 flex gap-3 rounded-2xl border border-line bg-[#f8fafc] p-4 text-sm leading-relaxed text-slate-600">
          <LifeBuoy className="mt-0.5 shrink-0 text-primary" size={20} />
          <div>
            <p>Password resets are handled by your {tenant} project contact. Ask them to issue a temporary password; you will be asked to choose a new one when you sign in.</p>
            {pm && <p className="mt-3 font-semibold text-dark">{pm.name}{pm.phone ? ` · ${pm.phone}` : ""}{pm.email ? ` · ${pm.email}` : ""}</p>}
          </div>
        </div>
        <Link href={`/p/${slug}/login`} className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"><ArrowLeft size={14} />Back to sign in</Link>
      </AuthShell>
    );
  }

  // Demo hint (local demo data only): shown when the owner still uses the published demo password.
  let hint: string | null = null;
  if (process.env.NODE_ENV !== "production") {
    const o = db.prepare("SELECT email, password_hash FROM portal_users WHERE subcontractor_id = ? AND portal_role = 'owner' AND status = 'active' AND must_change_password = 0 ORDER BY id LIMIT 1").get(sub.id) as { email: string; password_hash: string } | undefined;
    if (o && verifyPassword(DEMO_PORTAL_PASSWORD, o.password_hash)) hint = `${o.email} / ${DEMO_PORTAL_PASSWORD}`;
  }
  return (
    <AuthShell companyName={sub.name} tenant={tenant}>
      <div className={eyebrow}>Subcontractor Portal</div>
      <h1 className={h1}>Sign in to <span className="text-primary">{sub.name}</span></h1>
      <p className="mb-7 mt-2 text-[15px] text-slate-500">Work with {tenant} on site progress, invoices and payments.</p>
      {!available && <p role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">The portal is currently disabled for this company. Please contact your {tenant} project contact.</p>}
      <PortalLoginForm slug={slug} next={safeNext(next)} />
      {hint && <p data-testid="demo-hint" className="mt-6 flex items-start gap-2 rounded-xl bg-primary-50 px-3.5 py-2.5 text-xs font-semibold text-slate-600"><Info size={14} className="mt-0.5 shrink-0 text-primary" /><span>Demo login: <span className="font-mono text-dark">{hint}</span></span></p>}
    </AuthShell>
  );
}

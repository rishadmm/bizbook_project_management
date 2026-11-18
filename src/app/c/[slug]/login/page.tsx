import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Info, LifeBuoy } from "lucide-react";
import ClientAuthShell from "@/features/client-portal/components/ClientAuthShell";
import { getDb } from "@/lib/db";
import { getEntityById } from "@/lib/entities";
import { safeNext } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { clientPortalAvailable, getClientSession, type ClientRecord } from "@/lib/client-portal-auth";
import { DEMO_CLIENT_PASSWORD } from "@/lib/client-portal-core";
import { slugError } from "@/lib/portal-perms";
import ClientLoginForm from "./LoginForm";

const eyebrow = "text-[12px] font-extrabold uppercase tracking-[.08em] text-primary";
const h1 = "mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-dark";

export default async function ClientLoginPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string; forgot?: string }> }) {
  const { slug } = await params;
  const { next, forgot } = await searchParams;
  if (slugError(slug)) notFound();
  const db = getDb();
  const client = db.prepare("SELECT id, name, type, contact_person, email, phone, portal_slug, portal_enabled, portal_show_subcontractors, portal_show_financials, entity_id FROM clients WHERE portal_slug = ?").get(slug) as ClientRecord | undefined;
  if (!client) notFound();
  const tenant = getEntityById(client.entity_id)?.legal_name ?? "";
  const s = await getClientSession();
  if (s && s.client.id === client.id) redirect(s.user.mustChange ? `/c/${slug}/change-password` : `/c/${slug}`);
  const available = clientPortalAvailable(client);

  if (forgot !== undefined) {
    const pm = db.prepare(`SELECT u.name, u.phone, u.email FROM projects p JOIN users u ON u.id = p.manager_id WHERE p.client_id = ? AND p.status IN ('active','mobilizing') ORDER BY p.id LIMIT 1`).get(client.id) as { name: string; phone: string | null; email: string | null } | undefined;
    return (
      <ClientAuthShell clientName={client.name} tenant={tenant}>
        <div className={eyebrow}>Password help</div>
        <h1 className={h1}>Forgot your <span className="text-primary">password</span>?</h1>
        <div className="mt-6 flex gap-3 rounded-2xl border border-line bg-[#f8fafc] p-4 text-sm leading-relaxed text-slate-600">
          <LifeBuoy className="mt-0.5 shrink-0 text-primary" size={20} />
          <div>
            <p>Password resets are handled by your {tenant} project manager. Please contact them to receive a temporary password; you will be asked to choose a new one when you sign in.</p>
            {pm && <p className="mt-3 font-semibold text-dark">{pm.name}{pm.phone ? ` · ${pm.phone}` : ""}{pm.email ? ` · ${pm.email}` : ""}</p>}
          </div>
        </div>
        <Link href={`/c/${slug}/login`} className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"><ArrowLeft size={14} />Back to sign in</Link>
      </ClientAuthShell>
    );
  }

  // Demo hint (local demo data only): shown when an admin still uses the published demo password.
  let hint: string | null = null;
  if (process.env.NODE_ENV !== "production") {
    const o = db.prepare("SELECT email, password_hash FROM client_users WHERE client_id = ? AND role = 'admin' AND status = 'active' AND must_change_password = 0 ORDER BY id LIMIT 1").get(client.id) as { email: string; password_hash: string } | undefined;
    if (o && verifyPassword(DEMO_CLIENT_PASSWORD, o.password_hash)) hint = `${o.email} / ${DEMO_CLIENT_PASSWORD}`;
  }
  return (
    <ClientAuthShell clientName={client.name} tenant={tenant}>
      <div className={eyebrow}>Client Portal</div>
      <h1 className={h1}>Sign in to <span className="text-primary">{client.name}</span></h1>
      <p className="mb-7 mt-2 text-[15px] text-slate-500">Follow the progress of your projects with {tenant}.</p>
      {!available && <p role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">The portal is currently disabled for this client. Please contact your {tenant} project manager.</p>}
      <ClientLoginForm slug={slug} next={safeNext(next)} />
      {hint && <p data-testid="demo-hint" className="mt-6 flex items-start gap-2 rounded-xl bg-primary-50 px-3.5 py-2.5 text-xs font-semibold text-slate-600"><Info size={14} className="mt-0.5 shrink-0 text-primary" /><span>Demo login: <span className="font-mono text-dark">{hint}</span></span></p>}
    </ClientAuthShell>
  );
}

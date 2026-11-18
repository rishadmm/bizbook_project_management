import Link from "next/link";
import { Mail } from "lucide-react";
import { Badge, Button, CardSection, EmptyState, Input, LinkButton, PageHeader, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { getActiveEntity, requirePage } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { smtpConfigured } from "@/lib/mailer";
import { MAIL_TEMPLATES, mailTemplateLabel } from "@/lib/mail-templates";

export const metadata = { title: "Email outbox" };
type SP = { template?: string; status?: string; q?: string; id?: string };
type Row = { id: number; to_email: string; to_name: string | null; subject: string; template: string | null; status: string; error: string | null; created_at: string; related_type: string | null; related_id: number | null };
const TONE = { queued: "amber", sent: "green", logged: "blue", failed: "red" } as const;

export default async function EmailOutboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePage("settings", "view");
  const entity = await getActiveEntity();
  const sp = await searchParams;
  const db = getDb();
  const where = ["(entity_id = ? OR entity_id IS NULL)"]; const args: unknown[] = [entity.id];
  if (sp.template) { where.push("template = ?"); args.push(sp.template); }
  if (sp.status) { where.push("status = ?"); args.push(sp.status); }
  if (sp.q) { where.push("(lower(to_email) LIKE ? OR lower(subject) LIKE ?)"); args.push(`%${sp.q.toLowerCase()}%`, `%${sp.q.toLowerCase()}%`); }
  const rows = db.prepare(`SELECT id, to_email, to_name, subject, template, status, error, created_at, related_type, related_id FROM email_outbox WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 200`).all(...(args as never[])) as Row[];
  const total = (db.prepare("SELECT COUNT(*) c FROM email_outbox WHERE entity_id = ? OR entity_id IS NULL").get(entity.id) as { c: number }).c;
  const selId = Number(sp.id) || rows[0]?.id;
  const sel = selId ? (db.prepare("SELECT * FROM email_outbox WHERE id = ? AND (entity_id = ? OR entity_id IS NULL)").get(selId, entity.id) as (Row & { body_html: string | null; body_text: string | null }) | undefined) : undefined;
  const qs = (id: number) => { const q = new URLSearchParams(); for (const k of ["template", "status", "q"] as const) if (sp[k]) q.set(k, sp[k]!); q.set("id", String(id)); return `/admin/email-outbox?${q}`; };
  return (
    <>
      <PageHeader title="Email outbox" description={`Every e-mail the system sends is recorded here · ${entity.country}. ${smtpConfigured() ? "SMTP is configured: mails are delivered." : "Demo mode (no SMTP_URL): mails are logged here and nothing leaves the machine."}`}
        badges={<Badge tone={smtpConfigured() ? "green" : "blue"}>{smtpConfigured() ? "SMTP" : "Demo mode"}</Badge>} />
      <form className="mb-4 flex flex-wrap gap-2" data-testid="outbox-filters">
        <div className="w-60"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Search recipient or subject" /></div>
        <div className="w-56"><Select name="template" defaultValue={sp.template ?? ""} placeholder="All templates" options={MAIL_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))} /></div>
        <div className="w-40"><Select name="status" defaultValue={sp.status ?? ""} placeholder="All statuses" options={["queued", "sent", "logged", "failed"].map((s) => ({ value: s, label: s }))} /></div>
        <Button type="submit">Filter</Button>
        {(sp.q || sp.template || sp.status) && <LinkButton href="/admin/email-outbox" variant="ghost">Clear</LinkButton>}
      </form>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <CardSection title="Messages" subtitle={`${rows.length} shown of ${total}`} flush>
          {rows.length === 0 ? <div className="p-5"><EmptyState title="No mail" description="No e-mail matches the filter." /></div> : (
            <Table>
              <THead><TR><TH>When</TH><TH>To</TH><TH>Template</TH><TH>Status</TH></TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} data-testid="outbox-row" className={cn(r.id === sel?.id && "bg-primary-50")}>
                    <TD className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(r.created_at)}</TD>
                    <TD><Link href={qs(r.id)} className="font-semibold text-primary-dark hover:underline">{r.to_name ?? r.to_email}</Link><div className="max-w-[260px] truncate text-[11px] text-slate-400">{r.to_email}</div><div className="max-w-[260px] truncate text-xs text-slate-500">{r.subject}</div></TD>
                    <TD className="text-xs">{r.template ? mailTemplateLabel(r.template) : "—"}</TD>
                    <TD><Badge tone={TONE[r.status as keyof typeof TONE] ?? "slate"}>{r.status}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardSection>
        <CardSection title={<span className="flex items-center gap-2"><Mail size={15} className="text-primary" />Preview</span>} subtitle={sel ? `${sel.to_name ? `${sel.to_name} <${sel.to_email}>` : sel.to_email}` : undefined}>
          {!sel ? <p className="text-sm text-slate-400">Select a message to preview it.</p> : (
            <div data-testid="outbox-preview">
              <h3 className="text-sm font-extrabold text-dark">{sel.subject}</h3>
              <p className="mb-3 text-xs text-slate-500">{formatDateTime(sel.created_at)} · {sel.template ? mailTemplateLabel(sel.template) : "—"} · <Badge tone={TONE[sel.status as keyof typeof TONE] ?? "slate"}>{sel.status}</Badge>{sel.error ? ` · ${sel.error}` : ""}</p>
              <iframe title="Rendered e-mail" sandbox="" srcDoc={sel.body_html ?? ""} className="h-[560px] w-full rounded-xl border border-line bg-slate-100" data-testid="outbox-frame" />
            </div>
          )}
        </CardSection>
      </div>
    </>
  );
}

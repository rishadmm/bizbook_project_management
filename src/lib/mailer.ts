// Outgoing mail (SUPPLIER_TENDERING_SPEC A2). Every mail is written to `email_outbox` first (the audit trail and the demo proof).
//   - SMTP_URL (+ MAIL_FROM) set  -> status `queued`, delivered through nodemailer right after the caller's transaction, then `sent` / `failed`.
//   - no SMTP_URL (demo mode)      -> status `logged`: nothing leaves the machine.
// A mail failure never blocks the user action: `queueMail` / `sendMail` never throw. When the recipient is a supplier (`supplierId`) the mail also creates a
// `portal_notifications` row, so a supplier without a working mailbox still sees the message in the portal bell.
// No next/* imports: usable from server actions, approval handlers (synchronous, inside the engine transaction) and the seed.
import type { DB } from "./db";
import { getDb } from "./db";
import { renderMail, type MailCtx, type MailData, type MailTemplate } from "./mail-templates";

export const smtpConfigured = (): boolean => !!process.env.SMTP_URL;
export const mailFrom = (): string => process.env.MAIL_FROM || "BizBook <no-reply@bizbook.local>";
/** Public base URL used in mails sent from places without a request (approval handlers, seed). */
export const appBaseUrl = (): string => (process.env.APP_URL || "http://localhost:3100").replace(/\/+$/, "");

export interface MailInput {
  to: string; toName?: string | null; subject: string; html: string; text: string; template: MailTemplate | string;
  related?: { type: string; id: number } | null; entityId?: number | null;
  /** recipient is this supplier: also creates a portal notification */ supplierId?: number | null;
  /** notification only for this portal user (default: every user of the company) */ portalUserId?: number | null;
  /** destination of the portal notification (relative path) */ href?: string | null;
  /** seed / tests: explicit timestamp (SQL "YYYY-MM-DD HH:MM:SS") */ createdAt?: string;
}

const nowSql = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/** Synchronous core: writes the outbox row (+ the portal notification) and schedules SMTP delivery. Never throws. Returns the outbox id (0 on failure). */
export function queueMail(db: DB, m: MailInput): number {
  try {
    const smtp = smtpConfigured();
    const created = m.createdAt ?? nowSql();
    const noAddress = !m.to?.trim();
    const status = smtp && !noAddress ? "queued" : "logged";
    const id = Number(db.prepare(`INSERT INTO email_outbox(entity_id, to_email, to_name, subject, body_html, body_text, template, related_type, related_id, status, error, created_at, sent_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(m.entityId ?? null, noAddress ? "(no e-mail address)" : m.to.trim(), m.toName ?? null, m.subject, m.html, m.text, m.template,
      m.related?.type ?? null, m.related?.id ?? null, status, noAddress ? "No e-mail address on file: delivered as a portal notification only" : null, created, status === "logged" ? created : null).lastInsertRowid);
    if (m.supplierId) {
      db.prepare("INSERT INTO portal_notifications(subcontractor_id, portal_user_id, kind, title, body, href, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(m.supplierId, m.portalUserId ?? null, m.template, m.subject, m.text.split("\n").filter(Boolean).slice(1, 3).join(" ").slice(0, 240), m.href ?? null, created.includes("T") ? created : created.replace(" ", "T") + "Z");
    }
    if (status === "queued") setImmediate(() => { void deliver(db, id); });
    return id;
  } catch (e) {
    console.error("[mail] could not queue mail:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Public API: writes to the outbox and (with SMTP_URL) delivers; resolves with the outbox id. Never rejects. */
export async function sendMail(m: MailInput): Promise<number> {
  return queueMail(getDb(), m);
}

let transporter: { sendMail: (o: Record<string, unknown>) => Promise<unknown> } | null = null;
/** Delivers one queued outbox row through nodemailer and marks it sent / failed. */
export async function deliver(db: DB, outboxId: number): Promise<void> {
  const row = db.prepare("SELECT * FROM email_outbox WHERE id = ? AND status = 'queued'").get(outboxId) as
    { id: number; to_email: string; to_name: string | null; subject: string; body_html: string | null; body_text: string | null } | undefined;
  if (!row) return;
  try {
    if (!transporter) {
      const nodemailer = await import("nodemailer");
      transporter = nodemailer.createTransport(process.env.SMTP_URL as string) as unknown as typeof transporter;
    }
    await transporter!.sendMail({ from: mailFrom(), to: row.to_name ? `"${row.to_name.replace(/"/g, "")}" <${row.to_email}>` : row.to_email, subject: row.subject, html: row.body_html ?? undefined, text: row.body_text ?? undefined });
    db.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?").run(nowSql(), outboxId);
  } catch (e) {
    db.prepare("UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?").run((e instanceof Error ? e.message : String(e)).slice(0, 500), outboxId);
  }
}

/** Letterhead data of a country (legal name, address, contact) for the templates. */
export function mailContext(db: DB, entityId: number | null | undefined, recipientName: string, baseUrl: string = appBaseUrl()): MailCtx {
  const e = db.prepare("SELECT legal_name, country, address, email, phone FROM entities WHERE id = ?").get(entityId ?? 0) as MailCtx["entity"] | undefined;
  return { entity: e ?? { legal_name: "Al Noor Infrastructure LLC" }, baseUrl: baseUrl.replace(/\/+$/, ""), recipientName: recipientName || "Sir / Madam" };
}

/**
 * Renders a template for a supplier and queues it (outbox + portal notification). The recipient is the supplier's primary e-mail unless `to` is given.
 * `related` links the mail to a record (shown in the outbox).
 */
export function mailSupplier<T extends MailTemplate>(db: DB, supplierId: number, template: T, data: MailData[T], o: {
  to?: string | null; toName?: string | null; related?: { type: string; id: number }; baseUrl?: string; createdAt?: string; portalUserId?: number | null;
} = {}): number {
  const s = db.prepare("SELECT id, name, email, contact_person, portal_slug, entity_id FROM subcontractors WHERE id = ?").get(supplierId) as
    { id: number; name: string; email: string | null; contact_person: string | null; portal_slug: string | null; entity_id: number } | undefined;
  if (!s) return 0;
  const toName = o.toName ?? s.contact_person ?? s.name;
  const ctx = mailContext(db, s.entity_id, toName, o.baseUrl);
  const r = renderMail(template, ctx, data, s.portal_slug);
  return queueMail(db, { to: o.to ?? s.email ?? "", toName, subject: r.subject, html: r.html, text: r.text, template, related: o.related ?? { type: "subcontractor", id: s.id },
    entityId: s.entity_id, supplierId: s.id, portalUserId: o.portalUserId ?? null, href: r.href, createdAt: o.createdAt });
}

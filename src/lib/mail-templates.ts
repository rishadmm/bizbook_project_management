// Transactional e-mail templates (SUPPLIER_TENDERING_SPEC A2). PURE: no db / next imports, so the seed, the actions and the admin preview share them.
// Plain table-based BizBook-styled HTML (inline CSS, mail-client safe) with the country's legal name, logo text and footer, plus a text alternative.

export type MailTemplate =
  | "registration_received" | "registration_referred_back" | "registration_approved" | "registration_rejected"
  | "tender_invitation" | "addendum_issued" | "clarification_answered" | "bid_received" | "award_letter" | "regret" | "password_reset";

export const MAIL_TEMPLATES: { key: MailTemplate; label: string }[] = [
  { key: "registration_received", label: "Registration received" },
  { key: "registration_referred_back", label: "Registration referred back" },
  { key: "registration_approved", label: "Registration approved" },
  { key: "registration_rejected", label: "Registration rejected" },
  { key: "tender_invitation", label: "Tender invitation" },
  { key: "addendum_issued", label: "Addendum issued" },
  { key: "clarification_answered", label: "Clarification answered" },
  { key: "bid_received", label: "Bid received (receipt)" },
  { key: "award_letter", label: "Award (Letter of Award)" },
  { key: "regret", label: "Regret" },
  { key: "password_reset", label: "Password reset" },
];
export const mailTemplateLabel = (k: string) => MAIL_TEMPLATES.find((t) => t.key === k)?.label ?? k;

/** Who the mail comes from and where links point to. */
export interface MailCtx {
  entity: { legal_name: string; country?: string | null; address?: string | null; email?: string | null; phone?: string | null };
  /** `https://host` with no trailing slash: every link in a mail is absolute */ baseUrl: string;
  recipientName: string;
}
export interface RenderedMail { subject: string; html: string; text: string; /** in-portal destination of the matching notification (relative path) */ href: string | null }

const BRAND = "#635bff", DARK = "#0f172a", MUTED = "#64748b";
export const esc = (v: unknown): string => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) || iso.length <= 10 ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return iso.length <= 10 ? date : `${date} ${d.toISOString().slice(11, 16)} UTC`;
};
export const abs = (c: MailCtx, path: string) => (/^https?:\/\//.test(path) ? path : `${c.baseUrl}${path}`);

function button(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0"><tr><td style="border-radius:10px;background:${BRAND}"><a href="${esc(url)}" style="display:inline-block;padding:12px 22px;font:700 14px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`;
}
function rows(pairs: [string, string][]): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin:14px 0;border:1px solid #e2e8f0;border-radius:10px">${pairs.map(([k, v], i) =>
    `<tr><td style="padding:9px 14px;width:38%;font:700 12px Arial,Helvetica,sans-serif;color:${MUTED};${i ? "border-top:1px solid #e2e8f0;" : ""}">${esc(k)}</td><td style="padding:9px 14px;font:14px Arial,Helvetica,sans-serif;color:${DARK};${i ? "border-top:1px solid #e2e8f0;" : ""}">${v}</td></tr>`).join("")}</table>`;
}
const p = (html: string) => `<p style="margin:0 0 12px;font:14px/1.6 Arial,Helvetica,sans-serif;color:#334155">${html}</p>`;

function layout(c: MailCtx, title: string, bodyHtml: string): string {
  const foot = [c.entity.legal_name, c.entity.address, c.entity.email, c.entity.phone].filter(Boolean).map((x) => esc(x)).join(" &middot; ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f1f5f9;padding:24px 12px">
<table role="presentation" cellspacing="0" cellpadding="0" width="100%"><tr><td align="center">
<table role="presentation" cellspacing="0" cellpadding="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:${BRAND};padding:18px 28px"><span style="font:800 20px Arial,Helvetica,sans-serif;letter-spacing:-.02em;color:#ffffff">BizBook</span><span style="font:600 12px Arial,Helvetica,sans-serif;color:#e0e7ff;margin-left:10px">${esc(c.entity.legal_name)}</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font:800 20px/1.3 Arial,Helvetica,sans-serif;letter-spacing:-.01em;color:${DARK}">${esc(title)}</h1>
${p(`Dear ${esc(c.recipientName)},`)}
${bodyHtml}
${p(`Kind regards,<br>${esc(c.entity.legal_name)}`)}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">${foot}<br>This message was sent by the BizBook supplier portal. Please do not share links from this e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}

const bullets = (items: string[]) => `<ul style="margin:0 0 12px 18px;padding:0;font:14px/1.6 Arial,Helvetica,sans-serif;color:#334155">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

export interface RegistrationReceivedData { company: string; regNo: string }
export interface ReferredBackData { company: string; note: string | null; items: { label: string; comment: string | null }[]; round?: number }
export interface ApprovedData { company: string; grade: string; validUntil: string; categories: string[] }
export interface RejectedData { company: string; reason: string }
export interface TenderInvitationData { code: string; title: string; category: string | null; closingAt: string; procedure: string; tenderHref: string }
export interface AddendumData { code: string; title: string; no: number; addendumTitle: string; description: string | null; newClosingAt: string | null; tenderHref: string }
export interface ClarificationData { code: string; title: string; question: string; answer: string; tenderHref: string }
export interface BidReceivedData { code: string; title: string; submittedAt: string; receiptHash: string; revision: number; tenderHref: string }
export interface AwardData { code: string; title: string; contractValue: string; assignmentRef: string | null; letterHref: string; portalHref: string }
export interface RegretData { code: string; title: string; portalHref: string }
export interface PasswordResetData { resetUrl: string; hours: number }

export type MailData = {
  registration_received: RegistrationReceivedData; registration_referred_back: ReferredBackData; registration_approved: ApprovedData; registration_rejected: RejectedData;
  tender_invitation: TenderInvitationData; addendum_issued: AddendumData; clarification_answered: ClarificationData; bid_received: BidReceivedData;
  award_letter: AwardData; regret: RegretData; password_reset: PasswordResetData;
};

/** Renders a template. `portalSlug` is the supplier's /p/<slug> prefix (links into the portal). */
export function renderMail<T extends MailTemplate>(template: T, c: MailCtx, data: MailData[T], portalSlug: string | null = null): RenderedMail {
  const portal = portalSlug ? `/p/${portalSlug}` : "/suppliers/login";
  const open = (label: string, path: string) => button(label, abs(c, path));
  switch (template) {
    case "registration_received": {
      const d = data as RegistrationReceivedData;
      return {
        subject: `Registration received - ${d.regNo}`, href: `${portal}/registration`,
        html: layout(c, "We have received your registration", p(`Thank you for registering <strong>${esc(d.company)}</strong> as a supplier of ${esc(c.entity.legal_name)}. Your application is now in the review queue.`)
          + rows([["Registration no.", `<strong>${esc(d.regNo)}</strong>`], ["Status", "Submitted - waiting for review"]])
          + p("We will contact you if anything is missing. You can follow the status at any time in the supplier portal.") + open("Open supplier portal", `${portal}/registration`)),
        text: `Dear ${c.recipientName},\n\nWe have received the registration of ${d.company} (${d.regNo}). It is now in the review queue.\nFollow the status: ${abs(c, `${portal}/registration`)}\n\n${c.entity.legal_name}`,
      };
    }
    case "registration_referred_back": {
      const d = data as ReferredBackData;
      const list = d.items.length ? bullets(d.items.map((i) => `<strong>${esc(i.label)}</strong>${i.comment ? ` - ${esc(i.comment)}` : ""}`)) : "";
      return {
        subject: `Action required - your registration needs corrections`, href: `${portal}/registration`,
        html: layout(c, "Your registration has been referred back", p(`${esc(c.entity.legal_name)} reviewed the registration of <strong>${esc(d.company)}</strong> and needs the following to be corrected before it can be approved.`)
          + (d.note ? p(`<em>${esc(d.note)}</em>`) : "") + list + p("Please update the items above and resubmit your registration.") + open("Open supplier portal", `${portal}/registration`)),
        text: `Dear ${c.recipientName},\n\nThe registration of ${d.company} has been referred back.\n${d.note ? `${d.note}\n` : ""}${d.items.map((i) => `- ${i.label}${i.comment ? `: ${i.comment}` : ""}`).join("\n")}\n\nOpen the supplier portal: ${abs(c, `${portal}/registration`)}\n\n${c.entity.legal_name}`,
      };
    }
    case "registration_approved": {
      const d = data as ApprovedData;
      return {
        subject: `Registration approved - prequalified grade ${d.grade}`, href: `${portal}`,
        html: layout(c, "Your registration is approved", p(`Congratulations: <strong>${esc(d.company)}</strong> is now an approved supplier of ${esc(c.entity.legal_name)}.`)
          + rows([["Prequalification grade", `<strong>${esc(d.grade)}</strong>`], ["Valid until", esc(fmtDate(d.validUntil))], ["Approved categories", esc(d.categories.join(", ") || "—")]])
          + p("You can now receive tender invitations and bid on tenders in the supplier portal.") + open("Open supplier portal", `${portal}`)),
        text: `Dear ${c.recipientName},\n\n${d.company} is now an approved supplier (grade ${d.grade}, valid until ${fmtDate(d.validUntil)}).\nCategories: ${d.categories.join(", ")}\n\nOpen the supplier portal: ${abs(c, portal)}\n\n${c.entity.legal_name}`,
      };
    }
    case "registration_rejected": {
      const d = data as RejectedData;
      return {
        subject: `Registration decision`, href: `${portal}/registration`,
        html: layout(c, "Your registration was not approved", p(`${esc(c.entity.legal_name)} has reviewed the registration of <strong>${esc(d.company)}</strong> and is unable to approve it at this time.`)
          + rows([["Reason", esc(d.reason)]]) + p("You can still sign in to see the decision. If you believe this is a mistake, please contact the procurement team.") + open("Open supplier portal", `${portal}/registration`)),
        text: `Dear ${c.recipientName},\n\nThe registration of ${d.company} was not approved.\nReason: ${d.reason}\n\n${abs(c, `${portal}/registration`)}\n\n${c.entity.legal_name}`,
      };
    }
    case "tender_invitation": {
      const d = data as TenderInvitationData;
      return {
        subject: `Invitation to tender ${d.code} - ${d.title}`, href: d.tenderHref,
        html: layout(c, "You are invited to bid", p(`${esc(c.entity.legal_name)} invites you to submit a bid for the following supplier tender.`)
          + rows([["Tender", `<strong>${esc(d.code)}</strong> - ${esc(d.title)}`], ["Category", esc(d.category ?? "—")], ["Procedure", esc(d.procedure)], ["Closing", `<strong>${esc(fmtDate(d.closingAt))}</strong>`]])
          + open("View tender", d.tenderHref)),
        text: `Dear ${c.recipientName},\n\nYou are invited to bid for ${d.code} - ${d.title}.\nCategory: ${d.category ?? "-"} | Closing: ${fmtDate(d.closingAt)}\n${abs(c, d.tenderHref)}\n\n${c.entity.legal_name}`,
      };
    }
    case "addendum_issued": {
      const d = data as AddendumData;
      return {
        subject: `Addendum ${d.no} to tender ${d.code}`, href: d.tenderHref,
        html: layout(c, `Addendum ${d.no} issued`, p(`An addendum has been issued to tender <strong>${esc(d.code)}</strong> - ${esc(d.title)}. You must acknowledge it in the portal before you can submit your bid.`)
          + rows([["Addendum", `<strong>${esc(d.addendumTitle)}</strong>`], ["Details", esc(d.description ?? "—")], ["New closing date", esc(d.newClosingAt ? fmtDate(d.newClosingAt) : "Unchanged")]])
          + open("Review and acknowledge", d.tenderHref)),
        text: `Dear ${c.recipientName},\n\nAddendum ${d.no} (${d.addendumTitle}) was issued to ${d.code}. ${d.newClosingAt ? `New closing: ${fmtDate(d.newClosingAt)}. ` : ""}Please acknowledge it: ${abs(c, d.tenderHref)}\n\n${c.entity.legal_name}`,
      };
    }
    case "clarification_answered": {
      const d = data as ClarificationData;
      return {
        subject: `Clarification published - ${d.code}`, href: d.tenderHref,
        html: layout(c, "A clarification has been published", p(`A question on tender <strong>${esc(d.code)}</strong> - ${esc(d.title)} has been answered. Answers are shared anonymously with all bidders.`)
          + rows([["Question", esc(d.question)], ["Answer", esc(d.answer)]]) + open("View tender", d.tenderHref)),
        text: `Dear ${c.recipientName},\n\nClarification on ${d.code}:\nQ: ${d.question}\nA: ${d.answer}\n${abs(c, d.tenderHref)}\n\n${c.entity.legal_name}`,
      };
    }
    case "bid_received": {
      const d = data as BidReceivedData;
      return {
        subject: `Bid receipt - ${d.code}${d.revision > 1 ? ` (revision ${d.revision})` : ""}`, href: d.tenderHref,
        html: layout(c, "We have received your bid", p(`This is your receipt for tender <strong>${esc(d.code)}</strong> - ${esc(d.title)}. Keep it for your records.`)
          + rows([["Submitted at", esc(fmtDate(d.submittedAt))], ["Revision", String(d.revision)], ["Receipt hash (SHA-256)", `<span style="font-family:Consolas,monospace;font-size:12px;word-break:break-all">${esc(d.receiptHash)}</span>`]])
          + p("You can revise or withdraw your bid until the closing date. After closing it is read-only.") + open("View my bid", d.tenderHref)),
        text: `Dear ${c.recipientName},\n\nReceipt for ${d.code} - ${d.title}\nSubmitted: ${fmtDate(d.submittedAt)} (revision ${d.revision})\nReceipt hash: ${d.receiptHash}\n${abs(c, d.tenderHref)}\n\n${c.entity.legal_name}`,
      };
    }
    case "award_letter": {
      const d = data as AwardData;
      return {
        subject: `Letter of Award - ${d.code}`, href: d.portalHref,
        html: layout(c, "Letter of Award", p(`We are pleased to inform you that your bid for <strong>${esc(d.code)}</strong> - ${esc(d.title)} has been accepted.`)
          + rows([["Contract value", `<strong>${esc(d.contractValue)}</strong>`], ["Subcontract", esc(d.assignmentRef ?? "Being set up")]])
          + p("Your Letter of Award is available as a PDF. The subcontract is now active in your portal.") + button("Download Letter of Award", abs(c, d.letterHref)) + open("Open supplier portal", d.portalHref)),
        text: `Dear ${c.recipientName},\n\nYour bid for ${d.code} - ${d.title} has been accepted. Contract value: ${d.contractValue}.\nLetter of Award: ${abs(c, d.letterHref)}\nPortal: ${abs(c, d.portalHref)}\n\n${c.entity.legal_name}`,
      };
    }
    case "regret": {
      const d = data as RegretData;
      return {
        subject: `Tender ${d.code} - outcome`, href: d.portalHref,
        html: layout(c, "Tender outcome", p(`Thank you for bidding on <strong>${esc(d.code)}</strong> - ${esc(d.title)}. After careful evaluation your bid was not successful this time.`)
          + p("We appreciate the time and effort you put into your submission and hope to receive your bid on future tenders.") + open("Open supplier portal", d.portalHref)),
        text: `Dear ${c.recipientName},\n\nThank you for bidding on ${d.code} - ${d.title}. Your bid was not successful this time.\n${abs(c, d.portalHref)}\n\n${c.entity.legal_name}`,
      };
    }
    case "password_reset": {
      const d = data as PasswordResetData;
      return {
        subject: "Reset your supplier portal password", href: null,
        html: layout(c, "Reset your password", p(`We received a request to reset the password of your supplier portal account. The link below is valid for ${d.hours} hours and can be used once.`)
          + button("Choose a new password", d.resetUrl) + p("If you did not ask for this, you can ignore this e-mail: your password stays unchanged.")),
        text: `Dear ${c.recipientName},\n\nChoose a new password (valid ${d.hours} hours): ${d.resetUrl}\nIf you did not ask for this, ignore this e-mail.\n\n${c.entity.legal_name}`,
      };
    }
    default: throw new Error(`Unknown mail template ${String(template)}`);
  }
}

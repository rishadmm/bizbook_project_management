import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { REVIEW_SECTIONS, type SectionKey } from "@/lib/registration";
import type { ItemRow, Profile, RegDoc } from "../core";

const yn = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v ? "Yes" : "No");
const v = (x: unknown) => (x === null || x === undefined || String(x).trim() === "" ? "—" : String(x));
const maskIban = (i: string | null) => { const c = (i ?? "").replace(/\s+/g, ""); return c.length > 8 ? `${c.slice(0, 4)}${"*".repeat(c.length - 8)}${c.slice(-4)}` : v(c); };

/** Label / value rows of one reviewable section (shared by the supplier summary, the internal review page and the detail tab). */
export function sectionRows(p: Profile, key: SectionKey, opts: { fullIban?: boolean } = {}): [string, string][] {
  const s = p.sub;
  switch (key) {
    case "company": return [["Legal name", s.name], ["Legal form", v(s.legal_form)], [p.entityCode === "OM" ? "CR number" : "Trade licence no.", v(s.cr_no)], ["Registration expiry", formatDate(s.cr_expiry)],
      [p.entityCode === "OM" ? "VAT number" : "VAT / TRN", v(s.vat_no)], ["Year established", v(s.year_established)], ["Employees", v(s.employees)], ["Turnover", v(s.turnover_band)],
      ["Address", v(s.address)], ["Website", v(s.website)], ["Phone", v(s.phone)], ["Country", v(s.country_of_registration)]];
    case "categories": return [["Categories", p.categories.map((c) => c.name + (c.status === "approved" ? " (approved)" : c.status === "declined" ? " (declined)" : "")).join(", ") || "—"],
      ["Regions served", p.regions.join(", ") || "—"], ["Capacity", v(s.capacity_note)]];
    case "contacts": {
      const c = (r: string) => { const x = p.contacts[r]; return x ? [x.name, x.title, x.email, x.phone].filter(Boolean).join(" · ") || "—" : "—"; };
      return [["Primary contact", c("primary")], ["Authorised signatory", c("signatory")], ["Finance contact", c("finance")], ["HSE contact", c("hse")], ["Bank", v(s.bank_name)], ["Account name", v(s.account_name)],
        ["IBAN", opts.fullIban ? v(s.iban) : maskIban(s.iban)], ["SWIFT", v(s.swift)]];
    }
    case "hse": return [["Written HSE policy", yn(s.hse_has_policy)], ["LTI rate", v(s.hse_lti_rate)], ["ISO 9001", yn(s.iso_9001)], ["ISO 14001", yn(s.iso_14001)], ["ISO 45001", yn(s.iso_45001)],
      ...(p.entityCode === "OM" ? [["ICV score", s.icv_score === null ? "—" : `${s.icv_score}%`] as [string, string]] : [])];
    case "experience": return p.experience.length ? p.experience.map((e, i) => [`Reference ${i + 1}`, `${e.client} · ${e.project} · ${e.year}${e.value ? ` · ${e.value.toLocaleString("en-US")} ${e.currency ?? ""}` : ""}`] as [string, string]) : [["References", "—"]];
  }
}

export function ItemChip({ item }: { item?: ItemRow }) {
  if (!item) return null;
  if (item.status === "accepted") return <Badge tone="green"><CheckCircle2 size={11} className="mr-1" />Accepted</Badge>;
  if (item.status === "fixed") return <Badge tone="green"><CheckCircle2 size={11} className="mr-1" />Updated</Badge>;
  return <Badge tone="amber"><MessageSquareWarning size={11} className="mr-1" />Queried</Badge>;
}

/** Read-only summary of all sections with the reviewer's comment inline. `editHref(step)` adds the Edit links of the wizard. */
export function RegistrationSummary({ p, editHref }: { p: Profile; editHref?: (step: number) => string }) {
  return (
    <div className="space-y-4">
      {REVIEW_SECTIONS.map((sec) => {
        const item = p.items.find((i) => i.item_kind === "section" && i.item_ref === sec.key);
        return (
          <section key={sec.key} data-testid={`summary-${sec.key}`} className="rounded-xl border border-line p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2"><h4 className="text-sm font-extrabold text-dark">{sec.label}</h4><ItemChip item={item} />
              {editHref && <a href={editHref(sec.step)} className="ml-auto text-xs font-bold text-primary hover:underline">Edit</a>}</div>
            {item?.status === "query" && item.comment && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">Reviewer: {item.comment}</p>}
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {sectionRows(p, sec.key).map(([k, val]) => <div key={k}><dt className="text-[11px] font-bold uppercase tracking-wider text-muted">{k}</dt><dd className="break-words font-semibold text-dark">{val}</dd></div>)}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

export function DocExpiryChip({ d }: { d: Pick<RegDoc, "expiry_state" | "expiry_date"> }) {
  if (d.expiry_state === "expired") return <Badge tone="red">Expired</Badge>;
  if (d.expiry_state === "expiring") return <Badge tone="amber">Expires soon</Badge>;
  return null;
}

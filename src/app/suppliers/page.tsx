import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarClock, ClipboardCheck, FileSearch, Gavel, Globe2, HardHat, UserPlus } from "lucide-react";
import PublicShell from "@/features/supplier-registration/components/PublicShell";
import { getPublicNotices, publicCategories, publicCountries } from "@/features/supplier-registration/queries";
import { getSetting } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Become a supplier" };

const STEPS = [
  { icon: UserPlus, title: "Register", text: "Create your account and complete the company profile, contacts, bank details and references." },
  { icon: FileSearch, title: "Review", text: "Upload your licences, insurance and HSE documents. Our procurement team reviews every submission." },
  { icon: BadgeCheck, title: "Approved", text: "Get prequalified for your trades and receive a grade and validity period." },
  { icon: Gavel, title: "Bid on tenders", text: "Receive invitations, ask questions and submit sealed bids in the portal." },
];

export default async function SuppliersLanding() {
  const brand = getSetting("company_name", "Al Noor Infrastructure LLC").split(/\s+/).slice(0, 2).join(" ");
  const countries = publicCountries();
  const cats = publicCategories();
  const notices = getPublicNotices();
  return (
    <PublicShell active="home">
      <section className="relative overflow-hidden" style={{ background: "linear-gradient(160deg, #F3F0FF 0%, #EEF2FF 48%, #F8F7FF 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative mx-auto w-full max-w-[1100px] px-4 py-12 sm:px-6 md:py-20">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-[.08em] text-primary shadow-sm"><HardHat size={13} />Supplier registration</span>
          <h1 className="mt-5 max-w-3xl text-[34px] font-extrabold leading-[1.08] tracking-[-0.03em] text-dark sm:text-[46px]">Become an <span className="text-primary">{brand}</span> supplier</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">Register your company once, keep your documents in one place and bid on infrastructure packages in the UAE and Oman: telecom, civil, oil and gas and more.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/suppliers/register" className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-[15px] font-bold text-white shadow-brand hover:bg-primary-dark">Register your company<ArrowRight size={16} /></Link>
            <Link href="/suppliers/login" className="inline-flex h-12 items-center rounded-xl border-[1.5px] border-[#e2e8f0] bg-white px-6 text-[15px] font-bold text-dark hover:border-primary hover:text-primary">Sign in</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6" aria-labelledby="country-h">
        <h2 id="country-h" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-dark"><Globe2 size={20} className="text-primary" />Where do you want to register?</h2>
        <p className="mt-1 text-sm text-slate-500">A supplier registers with one country operation. You can register again for another country later.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="country-picker">
          {countries.map((c) => (
            <Link key={c.code} href={`/suppliers/register?country=${c.code}`} data-testid={`country-${c.code}`}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-card transition hover:border-primary hover:shadow-brand-sm">
              <span className="text-3xl leading-none" aria-hidden>{c.flag}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-extrabold text-dark">{c.legal}</span><span className="text-xs font-semibold text-slate-500">{c.country}</span></span>
              <ArrowRight size={16} className="shrink-0 text-primary" />
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-[#f8fafc] py-10" aria-labelledby="how-h">
        <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6">
          <h2 id="how-h" className="text-xl font-extrabold tracking-tight text-dark">How it works</h2>
          <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-line bg-white p-4 shadow-card">
                <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary-50 text-primary"><s.icon size={18} /></span><span className="text-xs font-extrabold uppercase tracking-wider text-muted">Step {i + 1}</span></div>
                <h3 className="mt-3 text-[15px] font-extrabold text-dark">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1100px] px-4 py-10 sm:px-6" aria-labelledby="cat-h">
        <h2 id="cat-h" className="text-xl font-extrabold tracking-tight text-dark">Trades we prequalify</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cats.map((g) => (
            <div key={g.group_name} className="rounded-2xl border border-line bg-white p-4 shadow-card">
              <h3 className="text-sm font-extrabold text-primary">{g.group_name}</h3>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">{g.names.map((n) => <li key={n} className="flex gap-2"><ClipboardCheck size={14} className="mt-0.5 shrink-0 text-slate-300" />{n}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line bg-[#f8fafc] py-10" aria-labelledby="board-h">
        <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 id="board-h" className="text-xl font-extrabold tracking-tight text-dark">Open tenders</h2><p className="mt-1 text-sm text-slate-500">Published notices only: documents and prices are available to approved suppliers who sign in.</p></div>
            <Link href="/suppliers/login" className="inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-bold text-white shadow-brand-sm hover:bg-primary-dark">Register / sign in to bid</Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white shadow-card" data-testid="notice-board">
            {notices.length === 0 ? (
              <p className="flex items-center gap-2 p-6 text-sm text-slate-500"><CalendarClock size={16} className="text-slate-400" />No tenders are open for bidding right now. Register to be invited when the next package is released.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notices.map((n) => (
                  <li key={n.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <span className="font-bold text-primary">{n.code}</span>
                    <span className="min-w-0 flex-1 basis-56 font-semibold text-dark">{n.title}</span>
                    <span className="text-slate-500">{n.category ?? "General"}</span>
                    <span className="whitespace-nowrap text-slate-500">{n.flag} {n.country}</span>
                    <span className="whitespace-nowrap text-xs font-semibold text-slate-600">Closes {formatDateTime(n.closing_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

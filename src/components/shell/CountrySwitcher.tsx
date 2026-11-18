"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { switchEntity } from "@/features/entities/actions";

export interface CountryOption { code: string; flag: string | null; shortName: string; country: string; legalName: string; currency: string }

/** Top-bar country switcher: flag + short name + currency (collapses to flag + code below xl). A static chip when the user has a single country. */
export default function CountrySwitcher({ active, options }: { active: string; options: CountryOption[] }) {
  const cur = options.find((o) => o.code === active) ?? options[0];
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  useEffect(() => { if (open) items.current[focus]?.focus(); }, [open, focus]);

  if (!cur) return null;
  const pill = "inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-700";

  if (options.length < 2) {
    return <span data-testid="country-chip" title={`${cur.legalName} · ${cur.currency}`} className={pill}><span aria-hidden className="text-base leading-none">{cur.flag}</span>{cur.shortName}<span className="hidden font-semibold text-slate-400 xl:inline">· {cur.currency}</span></span>;
  }

  const choose = (o: CountryOption) => {
    setOpen(false);
    if (o.code === cur.code) { btn.current?.focus(); return; }
    setError(null);
    start(async () => {
      const r = await switchEntity(o.code, path);
      if (!r.ok) { setError(r.error); return; }
      if (r.href) router.push(r.href);
      router.refresh();
    });
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => (f + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => (f - 1 + options.length) % options.length); }
    else if (e.key === "Home") { e.preventDefault(); setFocus(0); }
    else if (e.key === "End") { e.preventDefault(); setFocus(options.length - 1); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button ref={btn} type="button" data-testid="country-switcher" aria-haspopup="menu" aria-expanded={open} aria-label={`Country: ${cur.country}, ${cur.currency}. Change country`} disabled={pending}
        onClick={() => { setFocus(Math.max(0, options.findIndex((o) => o.code === cur.code))); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setFocus(Math.max(0, options.findIndex((o) => o.code === cur.code))); setOpen(true); } }}
        className={`${pill} hover:bg-primary-50 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:opacity-60`}>
        <span aria-hidden className="text-base leading-none">{cur.flag}</span>
        <span className="xl:hidden">{cur.code === "AE" ? "AE" : cur.code}</span>
        <span className="hidden xl:inline">{cur.shortName}<span className="ml-1.5 font-semibold text-slate-400">· {cur.currency}</span></span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" aria-label="Country" onKeyDown={onMenuKey} className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-2xl border border-line bg-white py-1.5 shadow-card">
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Working in</div>
          {options.map((o, i) => (
            <button key={o.code} ref={(el) => { items.current[i] = el; }} type="button" role="menuitemradio" aria-checked={o.code === cur.code} data-testid={`country-option-${o.code}`}
              onClick={() => choose(o)} tabIndex={i === focus ? 0 : -1}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-primary-50 focus:bg-primary-50 focus:outline-none">
              <span aria-hidden className="text-xl leading-none">{o.flag}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-dark">{o.country}</span>
                <span className="block truncate text-xs text-slate-500">{o.legalName} · {o.currency}</span>
              </span>
              {o.code === cur.code && <Check size={16} className="shrink-0 text-primary" />}
            </button>
          ))}
          {error && <p role="alert" className="px-3 pb-1.5 pt-1 text-xs font-semibold text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

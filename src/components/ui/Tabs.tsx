import Link from "next/link";
import { cn } from "./cn";

export interface TabDef { key: string; label: string; count?: number }

/**
 * URL-driven tabs (?tab=key). Server component: pass `active` (resolved from searchParams.tab via `resolveTab`).
 * `basePath` e.g. `/tenders/12`. Extra query params are preserved via `extraQuery`.
 */
export function Tabs({ tabs, active, basePath, extraQuery }: { tabs: TabDef[]; active: string; basePath: string; extraQuery?: Record<string, string | undefined> }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(extraQuery ?? {})) if (v) q.set(k, v);
        q.set("tab", t.key);
        return (
          <Link key={t.key} href={`${basePath}?${q.toString()}`} scroll={false}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold",
              active === t.key ? "border-primary text-primary font-bold" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** Resolve the active tab key from a Next `searchParams` value. */
export function resolveTab(sp: { tab?: string | string[] } | undefined, tabs: TabDef[], fallback?: string): string {
  const raw = Array.isArray(sp?.tab) ? sp?.tab[0] : sp?.tab;
  return tabs.some((t) => t.key === raw) ? (raw as string) : (fallback ?? tabs[0].key);
}

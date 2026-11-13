import Link from "next/link";
import type { ReactNode } from "react";
/** Page title row with optional breadcrumbs `[{label, href?}]`, description, right-aligned actions, and badges next to the title. */
export function PageHeader({ title, description, actions, breadcrumbs, badges }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: { label: string; href?: string }[]; badges?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {breadcrumbs && (
        <div className="mb-1 flex items-center gap-1 text-xs text-slate-500">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              {b.href ? <Link href={b.href} className="hover:text-blue-600">{b.label}</Link> : <span>{b.label}</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-slate-900">{title}</h1>{badges}</div>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

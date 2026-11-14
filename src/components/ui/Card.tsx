import type { ReactNode } from "react";
import { cn } from "./cn";

/** White bordered panel. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-line bg-white shadow-card", className)}>{children}</div>;
}
/** Card with optional title/actions header; `flush` removes body padding (for tables). */
export function CardSection({ title, subtitle, actions, children, className, flush }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <h3 className="text-sm font-extrabold tracking-tight text-dark">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </Card>
  );
}

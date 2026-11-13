import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <Inbox className="mb-2 text-slate-400" size={28} />
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {description && <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

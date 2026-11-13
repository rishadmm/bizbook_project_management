import { getActivity } from "@/lib/activity";
import { formatDateTime } from "@/lib/format";
import type { EntityType } from "@/lib/types";
import { CardSection } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

/** Activity log timeline for an entity (server component). */
export function ActivityTimeline({ entityType, entityId, limit = 100, title = "Activity" }: { entityType: EntityType; entityId: number; limit?: number; title?: string }) {
  const rows = getActivity(entityType, entityId, limit);
  return (
    <CardSection title={title}>
      {rows.length === 0 ? <EmptyState title="No activity yet" /> : (
        <ol className="relative ml-2 border-l border-slate-200">
          {rows.map((r) => (
            <li key={r.id} className="mb-4 ml-4">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-blue-500" />
              <div className="text-sm text-slate-800">{r.message ?? r.action}</div>
              <div className="text-xs text-slate-500">{r.user_name ?? "System"} · {formatDateTime(r.created_at)} · <span className="uppercase tracking-wide">{r.action}</span></div>
            </li>
          ))}
        </ol>
      )}
    </CardSection>
  );
}

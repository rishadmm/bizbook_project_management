import { Download, FileText, Trash2 } from "lucide-react";
import { listAttachments } from "@/lib/files";
import { ATTACHMENT_CATEGORIES } from "@/lib/status";
import { formatDateTime } from "@/lib/format";
import type { EntityType } from "@/lib/types";
import { CardSection } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import AttachmentUploadForm from "./AttachmentUploadForm";
import { deleteAttachment } from "./attachments-actions";

function size(n: number | null): string {
  if (!n) return "";
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * List + upload for any (entityType, entityId). Server component.
 * `revalidate` = the path to revalidate after upload/delete (the page this panel is on, e.g. `/tenders/12`).
 * `categories` defaults to ATTACHMENT_CATEGORIES[entityType]. `readOnly` hides upload/delete.
 */
export function AttachmentsPanel({ entityType, entityId, revalidate, categories, readOnly, title = "Documents" }: {
  entityType: EntityType; entityId: number; revalidate: string; categories?: string[]; readOnly?: boolean; title?: string;
}) {
  const cats = categories ?? ATTACHMENT_CATEGORIES[entityType] ?? [];
  const rows = listAttachments(entityType, entityId);
  return (
    <CardSection title={title} subtitle={`${rows.length} file${rows.length === 1 ? "" : "s"}`}>
      {!readOnly && <div className="mb-4 rounded-md bg-slate-50 p-3"><AttachmentUploadForm entityType={entityType} entityId={entityId} categories={cats} revalidate={revalidate} /></div>}
      {rows.length === 0 ? <EmptyState title="No documents yet" description="Uploaded files will appear here." /> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <FileText size={18} className="shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <a href={`/api/files/${a.id}`} target="_blank" className="block truncate text-sm font-medium text-primary-dark hover:underline">{a.filename}</a>
                <div className="text-xs text-slate-500">{size(a.size)} · {formatDateTime(a.created_at)}{a.uploader_name ? ` · ${a.uploader_name}` : ""}{a.note ? ` · ${a.note}` : ""}</div>
              </div>
              {a.category && <Badge>{a.category}</Badge>}
              <a href={`/api/files/${a.id}?download=1`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Download"><Download size={15} /></a>
              {!readOnly && (
                <form action={deleteAttachment}>
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="revalidate" value={revalidate} />
                  <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 size={15} /></button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </CardSection>
  );
}

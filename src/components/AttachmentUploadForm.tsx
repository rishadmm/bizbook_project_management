"use client";
import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Upload } from "lucide-react";
import { uploadAttachments } from "./attachments-actions";
import { Button, Input, Select } from "@/components/ui";

function Submit() {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="primary" disabled={pending}><Upload size={14} />{pending ? "Uploading…" : "Upload"}</Button>;
}

/** Client upload form used by AttachmentsPanel. */
export default function AttachmentUploadForm({ entityType, entityId, categories, revalidate }: { entityType: string; entityId: number; categories: string[]; revalidate: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={async (fd) => { await uploadAttachments(fd); ref.current?.reset(); }} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="revalidate" value={revalidate} />
      {categories.length > 0 && <div className="w-40"><Select name="category" options={categories.map((c) => ({ value: c, label: c }))} /></div>}
      <div className="min-w-48 flex-1"><Input type="file" name="files" multiple required className="file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs" /></div>
      <div className="min-w-40 flex-1"><Input name="note" placeholder="Note (optional)" /></div>
      <Submit />
    </form>
  );
}

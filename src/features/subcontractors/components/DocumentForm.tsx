import { Button, Field, Input, Select } from "@/components/ui";
import { statusOptions } from "@/lib/status";
import { saveDocument } from "../actions";
import type { DocRow } from "../queries";

/** Add/edit a subcontractor document (with file upload). */
export function DocumentForm({ subcontractorId, doc }: { subcontractorId: number; doc?: DocRow }) {
  return (
    <form action={saveDocument} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="subcontractor_id" value={subcontractorId} />
      {doc && <input type="hidden" name="id" value={doc.id} />}
      <Field label="Type"><Select name="doc_type" defaultValue={doc?.doc_type ?? "trade_license"} options={statusOptions("docType")} /></Field>
      <Field label="Reference no."><Input name="ref_no" defaultValue={doc?.ref_no ?? ""} /></Field>
      <Field label="Issue date"><Input type="date" name="issue_date" defaultValue={doc?.issue_date ?? ""} /></Field>
      <Field label="Expiry date"><Input type="date" name="expiry_date" defaultValue={doc?.expiry_date ?? ""} /></Field>
      <Field label="Status"><Select name="status" defaultValue={doc?.status ?? "pending"} options={statusOptions("docStatus")} /></Field>
      <Field label={doc?.filename ? `File (current: ${doc.filename})` : "File"}><Input type="file" name="file" /></Field>
      <div className="md:col-span-2"><Button type="submit" variant="primary">{doc ? "Save document" : "Add document"}</Button></div>
    </form>
  );
}

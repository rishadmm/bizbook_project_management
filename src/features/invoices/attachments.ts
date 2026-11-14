// Saves the attachment rows of the invoice forms (parallel fields att_category / att_file) into the `attachments` table (entity_type = sub_invoice).
import { saveUpload } from "@/lib/files";
import { INVOICE_ATTACHMENT_CATEGORIES } from "@/lib/status";

export const MAX_INVOICE_FILE = 15 * 1024 * 1024;
const VALID = new Set(INVOICE_ATTACHMENT_CATEGORIES.map((c) => c.value));

export interface PendingUpload { file: File; category: string }

/** Reads and validates the upload rows. Throws via `fail` for bad categories / large files, or a missing tax invoice copy when `requireTaxInvoice`. */
export function readInvoiceUploads(form: FormData, opts: { requireTaxInvoice: boolean; fail: (msg: string) => never }): PendingUpload[] {
  const cats = form.getAll("att_category").map((v) => String(v ?? ""));
  const files = form.getAll("att_file");
  const out: PendingUpload[] = [];
  files.forEach((f, i) => {
    if (!(f instanceof File) || f.size === 0) return;
    const category = cats[i] || "other";
    if (!VALID.has(category)) opts.fail("Invalid attachment category");
    if (f.size > MAX_INVOICE_FILE) opts.fail("Files must be smaller than 15 MB");
    out.push({ file: f, category });
  });
  if (opts.requireTaxInvoice && !out.some((u) => u.category === "tax_invoice")) opts.fail("Attach a copy of your tax invoice (category: Tax invoice copy)");
  return out;
}

export async function saveInvoiceUploads(invoiceId: number, uploads: PendingUpload[], uploadedBy?: number | null): Promise<void> {
  for (const u of uploads) await saveUpload(u.file, "sub_invoice", invoiceId, u.category, uploadedBy === undefined ? {} : { uploadedBy });
}

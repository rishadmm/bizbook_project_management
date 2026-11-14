"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolvePortal } from "./queries";
import { PortalError, saveCertificateRequest, saveInvoice, saveProgressReport } from "./core";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Legacy quick-update link (/portal/[token]): token is re-validated on every call; errors come back as ?error= on the portal page. */
async function run(form: FormData, ok: string, fn: (ctx: NonNullable<ReturnType<typeof resolvePortal>>) => Promise<void>): Promise<never> {
  const token = str(form, "token");
  let url = `/portal/${encodeURIComponent(token)}`;
  try {
    const ctx = resolvePortal(token);
    if (!ctx) throw new PortalError("This link is no longer valid");
    await fn(ctx);
    revalidatePath(`/portal/${token}`);
    revalidatePath("/"); revalidatePath(`/projects/${ctx.project.id}`); revalidatePath("/invoices");
    url += `?sent=${ok}`;
  } catch (e) {
    url += `?error=${encodeURIComponent(e instanceof PortalError ? e.message : "Could not save your submission. Please try again.")}`;
    if (!(e instanceof PortalError)) console.error("portal action failed", e);
  }
  redirect(url);
}

export async function submitProgressReport(form: FormData): Promise<void> {
  await run(form, "progress", async ({ assignment: a, project, subcontractor }) => { await saveProgressReport(form, a, project, { name: subcontractor.contact_person || subcontractor.name }); });
}

export async function submitPortalInvoice(form: FormData): Promise<void> {
  await run(form, "invoice", async ({ assignment: a, project, subcontractor }) => {
    await saveInvoice(form, a, project, { name: str(form, "submitted_by_name") || subcontractor.contact_person || subcontractor.name, email: str(form, "submitted_by_email") || null });
  });
}

export async function requestPortalCertificate(form: FormData): Promise<void> {
  await run(form, "certificate", async ({ assignment: a, project, subcontractor }) => { await saveCertificateRequest(form, a, project, { name: subcontractor.contact_person || subcontractor.name }); });
}

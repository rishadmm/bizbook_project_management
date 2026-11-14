"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { ENUMS } from "@/lib/status";
import { requirePermission } from "@/lib/auth";
import { hasOpenRequest, submitForApproval } from "@/lib/approvals/engine";

const str = (f: FormData, k: string): string | null => String(f.get(k) ?? "").trim() || null;
const num = (f: FormData, k: string): number | null => { const v = String(f.get(k) ?? "").replace(/,/g, "").trim(); return v === "" || Number.isNaN(Number(v)) ? null : Number(v); };

export async function saveLossAnalysis(form: FormData): Promise<void> {
  const user = await requirePermission("lost_analysis", "edit");
  const id = Number(form.get("id"));
  const row = getDb().prepare("SELECT id, tender_id, status FROM loss_analyses WHERE id = ?").get(id) as { id: number; tender_id: number; status: string } | undefined;
  if (!row) throw new Error("Loss analysis not found");
  const reason = str(form, "primary_reason") ?? "other";
  const requested = str(form, "status") ?? "open";
  if (!(reason in ENUMS.lossReason)) throw new Error("Invalid reason");
  if (!(requested in ENUMS.lossStatus)) throw new Error("Invalid status");
  // Closing goes through the loss_analysis approval workflow; the status changes to closed on final approval.
  const closing = requested === "closed" && row.status !== "closed";
  const status = closing ? (row.status === "open" ? "in_review" : row.status) : requested;
  const winner = num(form, "winner_price"); const ours = num(form, "our_price");
  const gap = winner && ours ? ((ours - winner) / winner) * 100 : num(form, "price_gap_pct");
  const score = num(form, "technical_score");
  getDb().prepare(`UPDATE loss_analyses SET primary_reason=?, secondary_reasons=?, winner_name=?, winner_price=?, our_price=?, price_gap_pct=?, technical_score=?,
    client_feedback=?, root_cause=?, lessons_learned=?, action_items=?, owner_id=?, status=? WHERE id=?`)
    .run(reason, str(form, "secondary_reasons"), str(form, "winner_name"), winner, ours, gap, score === null ? null : Math.min(100, Math.max(0, score)),
      str(form, "client_feedback"), str(form, "root_cause"), str(form, "lessons_learned"), str(form, "action_items"), num(form, "owner_id"), status, id);
  if (closing && !hasOpenRequest("loss_analysis", id)) {
    submitForApproval("loss_analysis", id, { userId: user.id });
    await logActivity("loss", id, "approval", "Loss analysis closure submitted for approval");
  }
  await logActivity("loss", id, "updated", `Loss analysis saved (${status})`);
  await logActivity("tender", row.tender_id, "loss", "Loss analysis updated");
  revalidatePath(`/lost-analysis/${id}`); revalidatePath("/lost-analysis"); revalidatePath("/", "layout");
}

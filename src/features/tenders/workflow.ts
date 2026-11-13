import type { TenderStatus } from "@/lib/types";

/** Status machine (SPEC s3). Won / Lost are handled by dedicated actions (they create a project / loss analysis). */
export const TRANSITIONS: Record<string, TenderStatus[]> = {
  draft: ["in_preparation", "cancelled", "no_bid"],
  in_preparation: ["under_review", "cancelled", "no_bid"],
  under_review: ["approved", "in_preparation", "cancelled", "no_bid"],
  approved: ["submitted", "in_preparation", "cancelled", "no_bid"],
  submitted: ["negotiation", "won", "lost", "cancelled"],
  negotiation: ["won", "lost", "cancelled"],
};

export const TERMINAL: TenderStatus[] = ["won", "lost", "cancelled", "no_bid"];
export const canMove = (from: string, to: TenderStatus): boolean => (TRANSITIONS[from] ?? []).includes(to);

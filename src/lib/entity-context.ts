// Page / action guards for the active country (MULTI_COUNTRY_SPEC section 3).
import { notFound } from "next/navigation";
import { getSession, requireUser, type AuthUser } from "./auth";
import { getEntityById, type Entity } from "./entities";
import { setRequestCurrency } from "./request-context";

export interface RecordEntity { entity: Entity; /** the record belongs to another country than the active one */ foreign: boolean; active: Entity }

/**
 * Detail-page guard. The record's country must be one the user may access (else 404 - users never learn that another country's record exists).
 * Sets the request currency to the RECORD's currency so every amount on the page is shown in the right currency; `foreign` drives the
 * "This project belongs to Oman · Switch to Oman" info bar.
 */
export async function assertRecordAccess(entityId: number | null | undefined): Promise<RecordEntity> {
  const s = await getSession();
  if (!s) notFound();
  const entity = getEntityById(entityId);
  if (!entity || !s.user.entityIds.includes(entity.id)) notFound();
  setRequestCurrency(entity.currency);
  return { entity, foreign: entity.id !== s.entity.id, active: s.entity };
}

/** Server-action guard: the signed-in user may work on records of this country, else throws (action result "not found"). */
export async function requireRecordAccess(entityId: number | null | undefined): Promise<{ user: AuthUser; entity: Entity }> {
  const user = await requireUser();
  const entity = getEntityById(entityId);
  if (!entity || !user.entityIds.includes(entity.id)) throw new Error("Record not found.");
  return { user, entity };
}

/** Throws unless the active (or any accessible) country of the user owns the record. Use for record ids that arrive from forms. */
export function userCanAccessEntity(user: AuthUser, entityId: number | null | undefined): boolean {
  return !!entityId && user.entityIds.includes(entityId);
}

/** Sync guard for server actions: the user may touch records of this country, else the record "does not exist". */
export function assertUserEntity(user: AuthUser, entityId: number | null | undefined, what = "Record"): void {
  if (!entityId || !user.entityIds.includes(entityId)) throw new Error(`${what} not found`);
}

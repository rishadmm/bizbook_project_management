import { getDb } from "./db";
import { getCurrentUser } from "./session";
import type { ActivityLog, EntityType } from "./types";

/**
 * Records an entry in activity_log for the current user. Call from every server action.
 * Pass `userId` to override (e.g. portal submissions: use null).
 */
export async function logActivity(
  entityType: EntityType, entityId: number, action: string, message: string, userId?: number | null,
): Promise<void> {
  const uid = userId === undefined ? (await getCurrentUser()).id || null : userId;
  getDb()
    .prepare("INSERT INTO activity_log(entity_type, entity_id, action, message, user_id) VALUES (?,?,?,?,?)")
    .run(entityType, entityId, action, message, uid);
}

export type ActivityRow = ActivityLog & { user_name: string | null };

/** Latest activity for an entity (newest first). */
export function getActivity(entityType: EntityType, entityId: number, limit = 100): ActivityRow[] {
  return getDb()
    .prepare(
      `SELECT a.*, u.name AS user_name FROM activity_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT ?`,
    )
    .all(entityType, entityId, limit) as ActivityRow[];
}

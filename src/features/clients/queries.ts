import { getDb } from "@/lib/db";
import type { Client, Project, Tender } from "@/lib/types";

export type ClientRow = Client & { tender_count: number; won_count: number; lost_count: number; project_count: number; won_value: number };
export function listClients(entityId: number): ClientRow[] {
  return getDb().prepare(`SELECT c.*,
    (SELECT COUNT(*) FROM tenders t WHERE t.client_id = c.id) AS tender_count,
    (SELECT COUNT(*) FROM tenders t WHERE t.client_id = c.id AND t.status = 'won') AS won_count,
    (SELECT COUNT(*) FROM tenders t WHERE t.client_id = c.id AND t.status = 'lost') AS lost_count,
    (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
    (SELECT COALESCE(SUM(t.won_value),0) FROM tenders t WHERE t.client_id = c.id AND t.status = 'won') AS won_value
    FROM clients c WHERE c.entity_id = ? ORDER BY c.name`).all(entityId) as ClientRow[];
}
export function getClient(id: number): Client | undefined {
  return getDb().prepare("SELECT * FROM clients WHERE id = ?").get(id) as Client | undefined;
}
export type ClientTender = Tender & { rev_price: number };
export function clientTenders(id: number): ClientTender[] {
  return getDb().prepare(`SELECT t.*, COALESCE(r.total_price,0) AS rev_price FROM tenders t LEFT JOIN tender_revisions r ON r.id = t.current_revision_id
    WHERE t.client_id = ? ORDER BY t.id DESC`).all(id) as ClientTender[];
}
export function clientProjects(id: number): Project[] {
  return getDb().prepare("SELECT * FROM projects WHERE client_id = ? ORDER BY id DESC").all(id) as Project[];
}

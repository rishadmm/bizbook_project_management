import type { MapFeature, MapLegendItem } from "@/components/map/types";
import { RAG_HEX, statusHex, statusLabel, ENUMS, TONE_HEX } from "@/lib/status";
import { pct } from "@/lib/format";
import { formatLocal } from "@/lib/rfx";
import type { ProjectListItem, ProjectRow, StageRowEx } from "../queries";
import { esc, parseFeatures } from "../geo";
import { BRAND, MAP_COLORS } from "@/lib/theme";

export const STAGE_LEGEND: MapLegendItem[] = (["not_started", "in_progress", "delayed", "on_hold", "completed"] as const)
  .map((k) => ({ label: ENUMS.stageStatus[k].label, color: TONE_HEX[ENUMS.stageStatus[k].tone] }));

export function projectMapFeatures(
  p: ProjectRow, stages: StageRowEx[], subsByStage: Map<number, string[]>, editable: boolean, chips?: Map<number, { code: string; status: string; closing_at: string | null }>,
): MapFeature[] {
  const out: MapFeature[] = [];
  const withGeom = stages.filter((s) => s.geometry);
  parseFeatures(p.geometry).forEach((f, i) => {
    out.push({ id: `p${i}`, kind: "project", geometry: f.geometry, color: withGeom.length && !editable ? MAP_COLORS.remaining : BRAND.primary, label: p.name, editable: true });
  });
  for (const s of withGeom) {
    const g = parseFeatures(s.geometry)[0];
    if (!g) continue;
    const subs = subsByStage.get(s.id) ?? [];
    out.push({
      id: s.id, kind: "stage", geometry: g.geometry, color: statusHex("stageStatus", s.status), label: `${s.code ?? ""} ${s.name}`.trim(),
      progressPct: s.progress.actualPct, editable,
      href: `/projects/${p.id}/stages/${s.id}`,
      popupHtml: `<div>${esc(statusLabel("stageStatus", s.status))} · actual <b>${pct(s.progress.actualPct, 0)}</b> vs planned ${pct(s.progress.plannedPct, 0)}</div>` +
        `<div>${subs.length ? `Subcontractor: ${esc(subs.join(", "))}` : "No subcontractor assigned"}</div>` +
        (chips?.get(s.id) ? `<div><b>${chips.get(s.id)!.status === "awarded" ? "Awarded via" : "Out to tender ·"} ${esc(chips.get(s.id)!.code)}</b>${chips.get(s.id)!.closing_at && chips.get(s.id)!.status === "published" ? ` · closes ${esc(formatLocal(chips.get(s.id)!.closing_at, false))}` : ""}</div>` : ""),
    });
  }
  return out;
}

export function portfolioFeatures(projects: ProjectListItem[]): MapFeature[] {
  const out: MapFeature[] = [];
  for (const p of projects) {
    const color = RAG_HEX[p.metrics.rag];
    parseFeatures(p.geometry).forEach((f, i) => out.push({
      id: `${p.id}-${i}`, kind: "project", geometry: f.geometry, color, label: `${p.code} ${p.name}`, progressPct: p.metrics.actualPct, editable: false,
      href: `/projects/${p.id}`,
      popupHtml: `<div>${esc(p.client_name ?? "")}</div><div>Actual <b>${pct(p.metrics.actualPct, 0)}</b> vs planned ${pct(p.metrics.plannedPct, 0)} · ${esc(statusLabel("projectStatus", p.status))}</div>`,
    }));
  }
  return out;
}

export const RAG_LEGEND: MapLegendItem[] = [
  { label: "On track", color: RAG_HEX.green }, { label: "At risk", color: RAG_HEX.amber }, { label: "Critical", color: RAG_HEX.red }, { label: "No data", color: RAG_HEX.grey },
];

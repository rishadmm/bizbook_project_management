import * as turf from "@turf/turf";
import type { MapFeature } from "@/components/map/types";

/** Parse a stored geometry (Feature, FeatureCollection or bare Geometry) into a list of Features. */
export function parseFeatures(raw: string | null | undefined): GeoJSON.Feature[] {
  if (!raw) return [];
  try {
    const g = JSON.parse(raw) as GeoJSON.GeoJSON;
    if (g.type === "FeatureCollection") return g.features.filter((f) => f.geometry);
    if (g.type === "Feature") return g.geometry ? [g] : [];
    return [{ type: "Feature", properties: {}, geometry: g as GeoJSON.Geometry }];
  } catch { return []; }
}

export function parseGeometries(raw: string | null | undefined): GeoJSON.Geometry[] {
  return parseFeatures(raw).map((f) => f.geometry);
}

/** First LineString of a stored geometry (MultiLineString is concatenated). */
export function firstLine(raw: string | null | undefined): GeoJSON.LineString | null {
  for (const g of parseGeometries(raw)) {
    if (g.type === "LineString" && g.coordinates.length > 1) return g;
    if (g.type === "MultiLineString") {
      const coords = g.coordinates.flat();
      if (coords.length > 1) return { type: "LineString", coordinates: coords };
    }
  }
  return null;
}

export interface Measure { km: number | null; sqm: number | null }
/** Length (km) of lines and area (sqm) of polygons in a stored geometry. */
export function measureGeometry(raw: string | null | undefined): Measure {
  let km = 0, sqm = 0, hasLine = false, hasArea = false;
  for (const g of parseGeometries(raw)) {
    try {
      if (g.type === "LineString" || g.type === "MultiLineString") { km += turf.length({ type: "Feature", properties: {}, geometry: g }, { units: "kilometers" }); hasLine = true; }
      if (g.type === "Polygon" || g.type === "MultiPolygon") { sqm += turf.area({ type: "Feature", properties: {}, geometry: g }); hasArea = true; }
    } catch { /* ignore invalid geometry */ }
  }
  return { km: hasLine ? km : null, sqm: hasArea ? sqm : null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Slice a line into consecutive segments at the given boundaries (km, ascending, incl. 0 and total). */
export function sliceLine(line: GeoJSON.LineString, bounds: number[]): { from: number; to: number; feature: GeoJSON.Feature<GeoJSON.LineString> }[] {
  const out: { from: number; to: number; feature: GeoJSON.Feature<GeoJSON.LineString> }[] = [];
  const total = turf.length(turf.lineString(line.coordinates), { units: "kilometers" });
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i], to = Math.min(bounds[i + 1], total);
    if (to - from <= 0.0005) continue;
    const seg = turf.lineSliceAlong(turf.lineString(line.coordinates), from, to, { units: "kilometers" });
    out.push({ from: r2(from), to: r2(to), feature: { type: "Feature", properties: {}, geometry: seg.geometry } });
  }
  return out;
}

export function lineLengthKm(line: GeoJSON.LineString): number {
  return turf.length(turf.lineString(line.coordinates), { units: "kilometers" });
}

export function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Map features for a stored geometry, split into one MapFeature per Feature. */
export function toMapFeatures(raw: string | null | undefined, base: Omit<MapFeature, "geometry" | "id">, idPrefix: string): MapFeature[] {
  return parseFeatures(raw).map((f, i) => ({ ...base, id: `${idPrefix}${i}`, geometry: f.geometry }));
}

/** Extracts the drawable GeoJSON geometries out of a stored Feature / FeatureCollection / Geometry JSON string. */
export function extractGeometries(json: string | null | undefined): GeoJSON.Geometry[] {
  if (!json) return [];
  try {
    const g = JSON.parse(json) as GeoJSON.GeoJSON;
    if (g.type === "FeatureCollection") return g.features.map((f) => f.geometry).filter(Boolean);
    if (g.type === "Feature") return g.geometry ? [g.geometry] : [];
    if (g.type === "GeometryCollection") return g.geometries;
    return [g];
  } catch { return []; }
}

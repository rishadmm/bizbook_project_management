export interface MapFeature {
  id: string | number;
  kind: "project" | "stage";
  /** GeoJSON geometry (LineString/MultiLineString/Polygon/MultiPolygon/Point) */
  geometry: GeoJSON.Geometry;
  /** hex colour; for lines with progressPct this is the base (remaining) colour */
  color?: string;
  label?: string;
  /** 0-100. LineStrings draw a green completed slice (turf lineSliceAlong) over the base line */
  progressPct?: number;
  /** extra HTML shown in the popup (trusted/own data only) */
  popupHtml?: string;
  /** link shown in the popup */
  href?: string;
  /** in editable mode: can the geometry be edited (default: kind === "project") */
  editable?: boolean;
}

export interface MapLegendItem { label: string; color: string }

export interface ProjectMapProps {
  features: MapFeature[];
  /** show geoman draw/edit toolbar + Save button */
  editable?: boolean;
  /**
   * Called with a FeatureCollection of ALL editable layers (existing ones keep properties {id, kind};
   * newly drawn ones get properties {kind: drawKind, isNew: true}).
   */
  onSave?: (geojson: GeoJSON.FeatureCollection) => void | Promise<void>;
  /** kind assigned to newly drawn shapes (default "project") */
  drawKind?: "project" | "stage";
  /** [lat, lng] used when there are no features (default Dubai) */
  center?: [number, number];
  zoom?: number;
  /** px number or css string (default 480) */
  height?: number | string;
  legend?: MapLegendItem[];
  className?: string;
}

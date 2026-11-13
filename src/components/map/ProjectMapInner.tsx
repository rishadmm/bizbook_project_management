"use client";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free";
import * as turf from "@turf/turf";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { LayersControl, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import type { MapFeature, ProjectMapProps } from "./types";

// Fix default marker icons under bundlers.
L.Icon.Default.mergeOptions({ iconUrl: iconUrl.src, iconRetinaUrl: iconRetinaUrl.src, shadowUrl: shadowUrl.src });

const DEFAULT_CENTER: [number, number] = [25.1, 55.3];
const GREEN = "#16a34a";
type LL = [number, number];
const flip = (c: number[]): LL => [c[1], c[0]];

function isEditable(f: MapFeature, editable: boolean): boolean {
  return editable && (f.editable ?? f.kind === "project");
}

function FeaturePopup({ f }: { f: MapFeature }) {
  return (
    <Popup>
      <div className="min-w-44 text-sm">
        {f.label && <div className="font-semibold text-slate-900">{f.label}</div>}
        {typeof f.progressPct === "number" && (
          <div className="my-1">
            <div className="h-1.5 overflow-hidden rounded bg-slate-200"><div className="h-full" style={{ width: `${Math.min(100, f.progressPct)}%`, background: GREEN }} /></div>
            <div className="text-xs text-slate-600">{f.progressPct.toFixed(0)}% complete</div>
          </div>
        )}
        {f.popupHtml && <div className="text-xs text-slate-700" dangerouslySetInnerHTML={{ __html: f.popupHtml }} />}
        {f.href && <a href={f.href} className="mt-1 inline-block text-xs font-medium text-blue-600">Open →</a>}
      </div>
    </Popup>
  );
}

function renderLine(coords: number[][], f: MapFeature, key: string) {
  const positions = coords.map(flip);
  const base = f.color ?? "#2563eb";
  const hasProgress = typeof f.progressPct === "number";
  let slice: LL[] | null = null;
  if (hasProgress && f.progressPct! > 0 && coords.length > 1) {
    try {
      const line = turf.lineString(coords);
      const len = turf.length(line, { units: "kilometers" });
      const done = Math.min(len, (len * f.progressPct!) / 100);
      slice = done >= len ? positions : turf.lineSliceAlong(line, 0, done, { units: "kilometers" }).geometry.coordinates.map(flip);
    } catch { slice = null; }
  }
  return (
    <Fragment key={key}>
      <Polyline positions={positions} pathOptions={{ color: hasProgress ? "#94a3b8" : base, weight: hasProgress ? 6 : 5, opacity: hasProgress ? 0.9 : 0.85 }}>
        <FeaturePopup f={f} />
      </Polyline>
      {slice && <Polyline positions={slice} pathOptions={{ color: GREEN, weight: 6, opacity: 0.95 }} interactive={false} />}
    </Fragment>
  );
}

function renderStatic(f: MapFeature) {
  const g = f.geometry;
  const k = String(f.id) + f.kind;
  switch (g.type) {
    case "LineString": return renderLine(g.coordinates, f, k);
    case "MultiLineString": return <Fragment key={k}>{g.coordinates.map((c, i) => renderLine(c, f, `${k}-${i}`))}</Fragment>;
    case "Polygon":
      return <Polygon key={k} positions={g.coordinates.map((r) => r.map(flip))} pathOptions={{ color: f.color ?? "#2563eb", weight: 2, fillOpacity: 0.2 }}><FeaturePopup f={f} /></Polygon>;
    case "MultiPolygon":
      return <Fragment key={k}>{g.coordinates.map((p, i) => <Polygon key={i} positions={p.map((r) => r.map(flip))} pathOptions={{ color: f.color ?? "#2563eb", weight: 2, fillOpacity: 0.2 }}><FeaturePopup f={f} /></Polygon>)}</Fragment>;
    case "Point":
      return <Marker key={k} position={flip(g.coordinates)}><FeaturePopup f={f} /></Marker>;
    default: return null;
  }
}

function FitBounds({ features, fitKey, center, zoom }: { features: MapFeature[]; fitKey: string; center: LL; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    const valid = features.filter((f) => f.geometry);
    if (valid.length) {
      const b = L.geoJSON(valid.map((f) => ({ type: "Feature", properties: {}, geometry: f.geometry }) as GeoJSON.Feature)).getBounds();
      if (b.isValid()) { map.fitBounds(b, { padding: [30, 30], maxZoom: 15 }); return; }
    }
    map.setView(center, zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

interface Measure { name: string; text: string }

function measure(layer: L.Layer, name: string): Measure | null {
  const gj = (layer as L.Polyline).toGeoJSON?.() as GeoJSON.Feature | undefined;
  if (!gj?.geometry) return null;
  const t = gj.geometry.type;
  if (t === "LineString" || t === "MultiLineString") return { name, text: `${turf.length(gj as GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>, { units: "kilometers" }).toFixed(3)} km` };
  if (t === "Polygon" || t === "MultiPolygon") {
    const a = turf.area(gj as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
    return { name, text: `${Math.round(a).toLocaleString("en-US")} sqm · ${(a / 10000).toFixed(2)} ha` };
  }
  return null;
}

/** Imperative geoman integration: editable layers, toolbar, live measurements, save collection. */
function EditController({ features, drawKind, onDirty, onMeasure, registerCollect }: {
  features: MapFeature[]; drawKind: "project" | "stage";
  onDirty: () => void; onMeasure: (m: Measure[]) => void; registerCollect: (fn: () => GeoJSON.FeatureCollection) => void;
}) {
  const map = useMap();
  const group = useRef<L.FeatureGroup | null>(null);
  useEffect(() => {
    const fg = L.featureGroup().addTo(map);
    group.current = fg;
    const recompute = () => {
      const ms: Measure[] = [];
      let i = 0;
      fg.eachLayer((l) => { const o = l as L.Layer & { feature?: GeoJSON.Feature }; const m = measure(l, (o.feature?.properties?.label as string) ?? `Shape ${++i}`); if (m) ms.push(m); });
      onMeasure(ms);
    };
    const attach = (layer: L.Layer) => {
      layer.on("pm:edit", () => { onDirty(); recompute(); });
      layer.on("pm:update", () => { onDirty(); recompute(); });
    };
    for (const f of features.filter((x) => isEditable(x, true))) {
      const gl = L.geoJSON({ type: "Feature", properties: { id: f.id, kind: f.kind, label: f.label }, geometry: f.geometry } as GeoJSON.Feature, {
        style: { color: f.color ?? "#2563eb", weight: 5 },
      });
      gl.eachLayer((l) => { (l as L.Layer & { feature?: GeoJSON.Feature }).feature = { type: "Feature", properties: { id: f.id, kind: f.kind, label: f.label }, geometry: f.geometry }; fg.addLayer(l); attach(l); });
    }
    map.pm.addControls({
      position: "topleft", drawMarker: true, drawPolyline: true, drawPolygon: true, drawRectangle: true,
      drawCircle: false, drawCircleMarker: false, drawText: false, cutPolygon: false, rotateMode: false, editMode: true, dragMode: true, removalMode: true,
    });
    map.pm.setGlobalOptions({ layerGroup: fg, pathOptions: { color: "#f59e0b", weight: 5 } });
    const onCreate = (e: { layer: L.Layer }) => {
      const l = e.layer as L.Layer & { feature?: GeoJSON.Feature };
      const gj = (l as L.Polyline).toGeoJSON() as GeoJSON.Feature;
      l.feature = { ...gj, properties: { kind: drawKind, isNew: true } };
      fg.addLayer(l); attach(l); onDirty(); recompute();
    };
    const onRemove = () => { onDirty(); setTimeout(recompute, 0); };
    map.on("pm:create", onCreate as L.LeafletEventHandlerFn);
    map.on("pm:remove", onRemove);
    recompute();
    registerCollect(() => ({
      type: "FeatureCollection",
      features: fg.getLayers().map((l) => {
        const o = l as L.Layer & { feature?: GeoJSON.Feature };
        const gj = (l as L.Polyline).toGeoJSON() as GeoJSON.Feature;
        return { ...gj, properties: { ...(o.feature?.properties ?? {}), kind: o.feature?.properties?.kind ?? drawKind } };
      }),
    }));
    return () => {
      map.off("pm:create", onCreate as L.LeafletEventHandlerFn);
      map.off("pm:remove", onRemove);
      map.pm.removeControls();
      map.removeLayer(fg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, features.map((f) => f.id + f.kind).join("|")]);
  return null;
}

export default function ProjectMapInner({ features, editable = false, onSave, drawKind = "project", center = DEFAULT_CENTER, zoom = 10, height = 480, legend, className }: ProjectMapProps) {
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const collect = useRef<(() => GeoJSON.FeatureCollection) | null>(null);
  const fitKey = useMemo(() => features.map((f) => `${f.kind}${f.id}`).join("|"), [features]);
  const staticFeatures = features.filter((f) => f.geometry && !isEditable(f, editable));

  async function save() {
    if (!collect.current || !onSave) return;
    setSaving(true);
    try { await onSave(collect.current()); setDirty(false); } finally { setSaving(false); }
  }

  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 ${className ?? ""}`} style={{ height }}>
      <MapContainer center={center} zoom={zoom} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Streets (OSM)">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite (Esri)">
            <TileLayer attribution="Tiles &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={19} />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitBounds features={features} fitKey={fitKey} center={center} zoom={zoom} />
        {staticFeatures.map(renderStatic)}
        {editable && (
          <EditController features={features} drawKind={drawKind} onDirty={() => setDirty(true)} onMeasure={setMeasures}
            registerCollect={(fn) => { collect.current = fn; }} />
        )}
      </MapContainer>
      {legend && legend.length > 0 && (
        <div className="absolute bottom-3 right-3 z-[1000] rounded-md bg-white/95 px-3 py-2 text-xs shadow">
          {legend.map((l) => <div key={l.label} className="flex items-center gap-2"><span className="h-2 w-4 rounded-sm" style={{ background: l.color }} />{l.label}</div>)}
        </div>
      )}
      {editable && (
        <div className="absolute bottom-3 left-3 z-[1000] max-w-xs rounded-md bg-white/95 p-2.5 text-xs shadow">
          <div className="mb-1 font-semibold text-slate-700">Measurements</div>
          {measures.length === 0 ? <div className="text-slate-500">Draw a line or area to measure.</div> : measures.map((m, i) => <div key={i} className="tabular-nums text-slate-700">{m.name}: {m.text}</div>)}
          {onSave && (
            <button type="button" onClick={save} disabled={!dirty || saving}
              className="mt-2 w-full rounded bg-blue-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">{saving ? "Saving…" : dirty ? "Save geometry" : "No changes"}</button>
          )}
        </div>
      )}
    </div>
  );
}

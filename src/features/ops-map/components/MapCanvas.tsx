"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { bboxClip, polygon as turfPolygon } from "@turf/turf";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polygon, Polyline, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { buildLine, pointAt, sliceLine, RESP_COLOR, RESP_LABEL, STATUS_LABEL, type LineGeom } from "../calc";
import type { Derived, OpsIssue, OpsMapData, OpsProject, OpsSegment, SegDerived } from "../types";
import { shortDate, slipText } from "./bits";

export type Basemap = "light" | "dark" | "sat";
export type DimLevel = 0 | 1 | 2; // 0 normal, 1 soft, 2 hard

// CARTO Positron/Dark Matter now require an API key; Esri's Light/Dark Gray canvases are the keyless equivalents (same look).
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const TILES: Record<Basemap, { url: string; labels?: string; attr: string; max: number; native: number }> = {
  light: { url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, attr: "Tiles &copy; Esri", max: 19, native: 16 },
  dark: { url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, attr: "Tiles &copy; Esri", max: 19, native: 16 },
  sat: { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attr: "Tiles &copy; Esri", max: 19, native: 19 },
};
export const ATTRIBUTION: Record<Basemap, string> = { light: "Tiles © Esri — Light Gray Canvas", dark: "Tiles © Esri — Dark Gray Canvas", sat: "Tiles © Esri — World Imagery" };

export interface Focus { bounds: [number, number, number, number]; nonce: number; zoomOnly?: boolean }
export interface Pad { l: number; r: number; t: number; b: number }

const divIcon = (html: string, size: [number, number], className = "om-icon") => L.divIcon({ html, className, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });

/* ------------------------------------------------------------------ segment layer */

interface SegProps {
  seg: OpsSegment; d: SegDerived; color: string; dim: DimLevel; selected: boolean; hover: boolean; compare: boolean; night: boolean;
  zoom: number; onSelect: (key: string, ll: L.LatLng) => void; onHover: (key: string | null) => void;
}

const SegmentLayer = memo(function SegmentLayer({ seg, d, color, dim, selected, hover, compare, night, zoom, onSelect, onHover }: SegProps) {
  const line = useMemo<LineGeom | null>(() => (seg.kind === "line" ? buildLine(seg.coords) : null), [seg]);
  const op = dim === 2 ? 0.1 : dim === 1 ? 0.45 : 1;
  const fa = Math.min(1, d.actualPct / 100), fp = Math.min(1, d.plannedPct / 100), fb = Math.min(1, d.basePct / 100);
  const emph = selected || hover;
  const stale = d.status === "not_started";
  const handlers = {
    click: (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onSelect(seg.key, e.latlng); },
    mouseover: () => onHover(seg.key),
    mouseout: () => onHover(null),
  };
  const tip = (
    <Tooltip sticky direction="top" offset={[0, -8]} className="om-tip" opacity={1}>
      <div style={{ minWidth: 150 }}>
        <div style={{ fontWeight: 800, fontSize: 12.5 }}>{seg.sub?.name ?? "Self-performed"}</div>
        <div style={{ color: "var(--om-muted)", fontSize: 11, marginBottom: 4 }}>{seg.stageName}</div>
        <div style={{ display: "flex", gap: 10, fontSize: 11.5, fontWeight: 700 }}>
          <span>{d.actualPct.toFixed(0)}% <span style={{ color: "var(--om-muted)", fontWeight: 600 }}>/ plan {d.plannedPct.toFixed(0)}%</span></span>
          <span>SPI {d.spi === null ? "—" : d.spi.toFixed(2)}</span>
        </div>
        <div style={{ fontSize: 11, marginTop: 3, color }}>{STATUS_LABEL[d.status]}{d.status !== "completed" && d.status !== "not_started" ? ` · ${slipText(d.slipDays)}` : ""}</div>
      </div>
    </Tooltip>
  );

  if (seg.kind === "polygon" && seg.rings) return <PolygonSeg seg={seg} d={d} color={color} op={op} emph={emph} selected={selected} night={night} handlers={handlers} tip={tip} zoom={zoom} />;
  if (!line) return null;

  const full = line.pts;
  const done = fa > 0 ? sliceLine(line, 0, fb) : null;
  const ghost = d.forecast && fa > fb ? sliceLine(line, fb, fa) : null;
  const rest = fa < 1 ? sliceLine(line, fa, 1) : null;
  const gap = Math.abs(fp - fa) > 0.006 && !stale ? sliceLine(line, Math.min(fp, fa), Math.max(fp, fa)) : null;
  const behindGap = fp > fa;
  const gapColor = behindGap ? "#EF4444" : "#22C55E";
  const planPt = compare && fp > 0 && fp < 1 ? pointAt(line, fp) : null;
  const front = fa > 0 && fa < 1 ? pointAt(line, fa) : stale ? null : null;
  const start = pointAt(line, 0);
  const mid = pointAt(line, 0.5);
  const showChain = zoom >= 12 && seg.chainFrom !== null;
  const showName = zoom >= 13;

  return (
    <>
      {emph && <Polyline positions={full} interactive={false} pathOptions={{ color: night ? "#fff" : "#0f172a", weight: 13, opacity: selected ? 0.9 : 0.35, lineCap: "round", className: "om-seg-path" }} />}
      <Polyline positions={full} interactive={false} pathOptions={{ color, weight: emph ? 24 : 17, opacity: (selected ? 0.3 : 0.17) * (dim === 2 ? 0.4 : 1), lineCap: "round", className: "om-seg-path" }} />
      {rest && <Polyline positions={rest} interactive={false} pathOptions={{ color: night ? "#64748b" : "#94a3b8", weight: 4, opacity: 0.95 * op, dashArray: "2 8", lineCap: "round", className: "om-seg-path" }} />}
      {done && <Polyline positions={done} interactive={false} pathOptions={{ color, weight: emph ? 7.5 : 6, opacity: op, lineCap: "round", className: "om-seg-path" }} />}
      {ghost && <Polyline positions={ghost} interactive={false} pathOptions={{ color, weight: 5, opacity: 0.75 * op, className: "om-ghost om-seg-path" }} />}
      {gap && <Polyline positions={gap} interactive={false} pathOptions={{ color: gapColor, weight: 12, opacity: 0.85 * op, dashArray: "1.6 3.4", lineCap: "butt", className: "om-seg-path" }} />}
      {d.active && done && dim < 2 && <Polyline positions={done} interactive={false} pathOptions={{ color: "#ffffff", weight: 3, opacity: 0.9 * op, className: "om-ants" }} />}
      {planPt && dim < 2 && (
        <Marker position={[planPt.lat, planPt.lng]} interactive={false} zIndexOffset={400}
          icon={divIcon(`<div class="om-plan" style="transform:rotate(${(planPt.bearing - 90).toFixed(0)}deg);opacity:${dim === 1 ? 0.5 : 1}"><i></i><b></b></div>`, [22, 22])} />
      )}
      {front && dim < 2 && (
        <Marker position={[front.lat, front.lng]} interactive={false} zIndexOffset={500}
          icon={divIcon(`<div class="om-front ${d.active ? "live" : ""} ${d.forecast ? "ghost" : ""} ${emph ? "sel" : ""}" style="--c:${color};opacity:${dim === 1 ? 0.5 : 1}"><u></u><b></b></div>`, [26, 26])} />
      )}
      {showChain && dim < 2 && <Marker position={[start.lat, start.lng]} interactive={false} icon={divIcon(`<div class="om-chain">km ${seg.chainFrom!.toFixed(1)}</div>`, [1, 1])} />}
      {showName && dim < 2 && (
        <Marker position={[mid.lat, mid.lng]} interactive={false} zIndexOffset={200}
          icon={divIcon(`<div class="om-label" style="margin-top:-20px"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:5px"></span>${escapeHtml(seg.sub?.name ?? "Self-performed")} · ${d.actualPct.toFixed(0)}%</div>`, [1, 1])} />
      )}
      <Polyline positions={full} pathOptions={{ color, weight: 24, opacity: 0, bubblingMouseEvents: false }} eventHandlers={handlers}>{tip}</Polyline>
    </>
  );
});

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); }

function PolygonSeg({ seg, d, color, op, emph, selected, night, handlers, tip, zoom }: {
  seg: OpsSegment; d: SegDerived; color: string; op: number; emph: boolean; selected: boolean; night: boolean;
  handlers: { click: (e: L.LeafletMouseEvent) => void; mouseover: () => void; mouseout: () => void }; tip: React.ReactNode; zoom: number;
}) {
  const rings = seg.rings!;
  const pos = useMemo(() => rings.map((r) => r.map((c) => [c[1], c[0]] as [number, number])), [rings]);
  const f = Math.min(1, d.actualPct / 100), fp = Math.min(1, d.plannedPct / 100);
  const [w, s, e, n] = seg.bbox;
  const horizontal = e - w >= n - s;
  const clip = (a: number, b: number) => {
    if (b <= a) return null;
    try {
      const box: [number, number, number, number] = horizontal ? [w + (e - w) * a, s, w + (e - w) * b, n] : [w, s + (n - s) * a, e, s + (n - s) * b];
      const g = bboxClip(turfPolygon(rings), box).geometry.coordinates as number[][][];
      return g.map((r) => r.map((c) => [c[1], c[0]] as [number, number]));
    } catch { return null; }
  };
  const done = useMemo(() => (f > 0 ? clip(0, f) : null), [f, rings]); // eslint-disable-line react-hooks/exhaustive-deps
  const gap = useMemo(() => (Math.abs(fp - f) > 0.01 ? clip(Math.min(fp, f), Math.max(fp, f)) : null), [fp, f, rings]); // eslint-disable-line react-hooks/exhaustive-deps
  const gapColor = fp > f ? "#EF4444" : "#22C55E";
  return (
    <>
      <Polygon positions={pos} interactive={false} pathOptions={{ color, weight: emph ? 3 : 2, opacity: op, dashArray: "6 6", fillColor: color, fillOpacity: (0.06 + 0.1 * (1 - f)) * op, className: "om-seg-path" }} />
      {done && <Polygon positions={done} interactive={false} pathOptions={{ color, weight: 0, fillColor: color, fillOpacity: (0.18 + 0.3 * f) * op, className: "om-seg-path" }} />}
      {gap && <Polygon positions={gap} interactive={false} pathOptions={{ color: gapColor, weight: 1, opacity: 0.8 * op, dashArray: "2 3", fillColor: gapColor, fillOpacity: 0.16 * op }} />}
      {selected && <Polygon positions={pos} interactive={false} pathOptions={{ color: night ? "#fff" : "#0f172a", weight: 3, fill: false, opacity: 0.9 }} />}
      <Polygon positions={pos} pathOptions={{ color, weight: 0, fillOpacity: 0, bubblingMouseEvents: false }} eventHandlers={handlers}>{tip}</Polygon>
      {zoom >= 12 && <Marker position={seg.mid} interactive={false} icon={divIcon(`<div class="om-label" style="opacity:${op < 0.5 ? 0.3 : 1}">${d.actualPct.toFixed(0)}% <span style="opacity:.55;font-weight:700">/ ${d.plannedPct.toFixed(0)}%</span></div>`, [1, 1])} />}
    </>
  );
}

/* ------------------------------------------------------------------ issues */

function IssueLayer({ issues, zoom, onPick }: { issues: OpsIssue[]; zoom: number; onPick: (i: OpsIssue) => void }) {
  const map = useMap();
  const groups = useMemo(() => {
    const cell = zoom < 12 ? 56 : 0;
    if (!cell) return issues.map((i) => ({ key: String(i.id), items: [i], lat: i.lat, lng: i.lng }));
    const m = new Map<string, OpsIssue[]>();
    for (const i of issues) {
      const p = map.project([i.lat, i.lng], zoom);
      const k = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(i);
    }
    return [...m.entries()].map(([key, items]) => ({ key, items, lat: items.reduce((a, b) => a + b.lat, 0) / items.length, lng: items.reduce((a, b) => a + b.lng, 0) / items.length }));
  }, [issues, zoom, map]);
  return (
    <>
      {groups.map((g) => {
        const top = g.items.reduce((a, b) => (b.impactDays > a.impactDays ? b : a), g.items[0]);
        const c = RESP_COLOR[top.resp] ?? "#64748B";
        const many = g.items.length > 1;
        return (
          <Marker key={g.key} position={[g.lat, g.lng]} zIndexOffset={800}
            icon={divIcon(`<div class="om-issue ${many ? "many" : ""}" style="background:${c}">${many ? g.items.length : "!"}</div>`, [1, 1])}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); if (many) map.flyTo([g.lat, g.lng], Math.min(map.getMaxZoom(), zoom + 2), { duration: 0.6 }); else onPick(top); } }}>
            <Tooltip direction="top" offset={[0, -14]} className="om-tip" opacity={1}>
              {many ? <b>{g.items.length} open issues</b> : (
                <div style={{ maxWidth: 220 }}>
                  <div style={{ fontWeight: 800, fontSize: 12 }}>{top.title}</div>
                  <div style={{ fontSize: 11, color: c, fontWeight: 700 }}>{RESP_LABEL[top.resp]}{top.impactDays ? ` · ${top.impactDays} d impact` : ""}</div>
                  <div style={{ fontSize: 10.5, color: "var(--om-muted)" }}>Raised {shortDate(top.raisedOn)}</div>
                </div>
              )}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ controllers */

function MapEvents({ onClear, onZoom, onMove }: { onClear: () => void; onZoom: (z: number) => void; onMove: () => void }) {
  const map = useMap();
  useMapEvents({
    click: () => onClear(),
    zoomend: () => onZoom(map.getZoom()),
    move: () => onMove(),
  });
  return null;
}

function FocusController({ focus, pad }: { focus: Focus | null; pad: Pad }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (!focus) return;
    const [w, s, e, n] = focus.bounds;
    const b = L.latLngBounds([s, w], [n, e]);
    const opts: L.FitBoundsOptions = { paddingTopLeft: [pad.l, pad.t], paddingBottomRight: [pad.r, pad.b], maxZoom: 15 };
    map.invalidateSize();
    if (first.current) { map.fitBounds(b, { ...opts, animate: false }); first.current = false; }
    else map.flyToBounds(b, { ...opts, duration: 1.1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);
  return null;
}

function Resizer({ tick }: { tick: string }) {
  const map = useMap();
  useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 60); return () => clearTimeout(t); }, [tick, map]);
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Imperative bridge: exposes zoom in/out to the toolbar and the card anchor projection. */
function Bridge({ api }: { api: React.MutableRefObject<MapApi | null> }) {
  const map = useMap();
  useEffect(() => {
    api.current = { zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut(), project: (ll) => map.latLngToContainerPoint(ll), size: () => map.getSize() };
    return () => { api.current = null; };
  }, [map, api]);
  return null;
}
export interface MapApi { zoomIn: () => void; zoomOut: () => void; project: (ll: L.LatLngExpression) => L.Point; size: () => L.Point }

/* ------------------------------------------------------------------ canvas */

export interface CanvasProps {
  data: OpsMapData; derived: Derived; segments: OpsSegment[]; projects: OpsProject[]; issues: OpsIssue[];
  colorOf: (s: OpsSegment) => string; dimOf: (s: OpsSegment) => DimLevel; projectBadge: (p: OpsProject) => { color: string; label: string };
  basemap: Basemap; night: boolean; compare: boolean; selectedKey: string | null; selectedProject: number | null;
  focus: Focus | null; pad: Pad; resizeTick: string;
  onSelectSeg: (key: string, ll: L.LatLng) => void; onClear: () => void; onPickProject: (id: number) => void; onPickIssue: (i: OpsIssue) => void;
  onMove: () => void; api: React.MutableRefObject<MapApi | null>;
}

export default function MapCanvas(p: CanvasProps) {
  const [zoom, setZoom] = useState(10);
  const [hover, setHover] = useState<string | null>(null);
  const tile = TILES[p.basemap];
  const selProj = p.projects.find((x) => x.id === p.selectedProject);
  return (
    <MapContainer center={[25.05, 55.25]} zoom={10} zoomControl={false} attributionControl={false} style={{ height: "100%", width: "100%" }} scrollWheelZoom zoomSnap={0.25} zoomDelta={0.5} wheelPxPerZoomLevel={90}>
      <TileLayer key={p.basemap} url={tile.url} attribution={tile.attr} maxZoom={tile.max} maxNativeZoom={tile.native} />
      {tile.labels && <TileLayer key={`${p.basemap}-l`} url={tile.labels} maxZoom={tile.max} maxNativeZoom={tile.native} opacity={0.9} />}
      <Resizer tick={p.resizeTick} />
      <Bridge api={p.api} />
      <FocusController focus={p.focus} pad={p.pad} />
      <MapEvents onClear={p.onClear} onZoom={setZoom} onMove={p.onMove} />
      {selProj && <Rectangle bounds={[[selProj.bbox[1], selProj.bbox[0]], [selProj.bbox[3], selProj.bbox[2]]]} interactive={false} pathOptions={{ color: "#635BFF", weight: 1.5, dashArray: "4 6", fillColor: "#635BFF", fillOpacity: 0.04, opacity: 0.7 }} />}
      {p.segments.map((s) => (
        <SegmentLayer key={s.key} seg={s} d={p.derived.seg.get(s.key)!} color={p.colorOf(s)} dim={p.dimOf(s)} selected={p.selectedKey === s.key} hover={hover === s.key}
          compare={p.compare} night={p.night} zoom={zoom} onSelect={p.onSelectSeg} onHover={setHover} />
      ))}
      {zoom < 12 && p.projects.map((pr) => {
        const b = p.projectBadge(pr);
        return (
          <Marker key={`pb${pr.id}`} position={[(pr.bbox[1] + pr.bbox[3]) / 2, (pr.bbox[0] + pr.bbox[2]) / 2]} zIndexOffset={900}
            icon={divIcon(`<div class="om-projbadge"><i style="background:${b.color}"></i>${escapeHtml(pr.code.replace("PRJ-", ""))} · ${escapeHtml(b.label)}</div>`, [1, 1])}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); p.onPickProject(pr.id); } }} />
        );
      })}
      <IssueLayer issues={p.issues} zoom={zoom} onPick={p.onPickIssue} />
    </MapContainer>
  );
}

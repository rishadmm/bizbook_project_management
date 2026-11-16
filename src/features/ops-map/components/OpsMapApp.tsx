"use client";
import "../ops-map.css";
import { ChevronUp, Layers, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { addDays, daysBetween } from "@/lib/format";
import { computeAll, computeKpis, computeParties, costColor, RESP_COLOR, STATUS_COLOR, stalenessColor, SELF_COLOR } from "../calc";
import type { ClientMode, ColorMode, OpsIssue, OpsMapData, OpsProject, OpsSegment } from "../types";
import KpiStrip, { type Emphasis } from "./KpiStrip";
import Legend, { subColor } from "./Legend";
import ProjectDrawer, { DelayChart } from "./ProjectDrawer";
import ProjectsRail, { EMPTY_FILTERS, type Filters } from "./ProjectsRail";
import SegmentCard from "./SegmentCard";
import TimeMachine from "./TimeMachine";
import { ColorSwitch, Tools } from "./Toolbar";
import { ATTRIBUTION, type Basemap, type DimLevel, type Focus, type MapApi } from "./MapCanvas";
import { RAG_COLOR } from "./bits";

const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false });

export interface InitialState { project: string | null; segment: string | null; color: string | null; date: string | null; sub: string | null; embed: boolean }

const RAIL_W = 312, DRAWER_W = 380, GAP = 12, RAIL_MIN = 84, AUTO_COLLAPSE_BELOW = 1700;
const ALL_MODES: ColorMode[] = ["health", "sub", "cause", "cost", "stale"];
const isIso = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function unionBbox(ps: OpsProject[]): [number, number, number, number] | null {
  if (!ps.length) return null;
  return ps.reduce<[number, number, number, number]>((b, p) => [Math.min(b[0], p.bbox[0]), Math.min(b[1], p.bbox[1]), Math.max(b[2], p.bbox[2]), Math.max(b[3], p.bbox[3])], [...ps[0].bbox]);
}

export default function OpsMapApp({ data, initial, clientMode }: { data: OpsMapData; initial: InitialState; clientMode?: ClientMode }) {
  const today = data.today;
  // client portal: no Cost mode (and no Subcontractor mode when the names are hidden)
  const MODES = useMemo(() => (clientMode ? ALL_MODES.filter((m) => m !== "cost" && (m !== "sub" || clientMode.showSubs)) : ALL_MODES), [clientMode]);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const mapApi = useRef<MapApi | null>(null);
  const anchor = useRef<L.LatLngExpression | null>(null);

  /* ---------- state ---------- */
  const segByParam = (v: string | null) => (v ? data.segments.find((s) => s.key === v || String(s.assignmentId) === v)?.key ?? null : null);
  const initialProject = initial.project ? data.projects.find((p) => String(p.id) === initial.project || p.code === initial.project)?.id ?? null : null;
  const initialSeg = segByParam(initial.segment);
  const [date, setDate] = useState<string>(isIso(initial.date) ? initial.date : today);
  const [mode, setMode] = useState<ColorMode>(MODES.includes(initial.color as ColorMode) ? (initial.color as ColorMode) : "health");
  const [night, setNight] = useState(false);
  const [sat, setSat] = useState(false);
  const [compare, setCompare] = useState(true);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, subs: (initial.sub ?? "").split(",").map(Number).filter((n) => data.subs.some((s) => s.id === n)) });
  const [emphasis, setEmphasis] = useState<Emphasis>(null);
  const [selProject, setSelProject] = useState<number | null>(initialProject ?? (initialSeg ? data.segments.find((s) => s.key === initialSeg)!.projectId : null));
  const [selKey, setSelKey] = useState<string | null>(initialSeg);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(1400);
  const [sheetTab, setSheetTab] = useState<"projects" | "details" | "delays">(initialProject || initialSeg ? "details" : "projects");
  const [sheetOpen, setSheetOpen] = useState(!!(initialProject || initialSeg));
  const nonce = useRef(0);
  const narrow = width < 900;

  /* ---------- derived ---------- */
  const derived = useMemo(() => computeAll(data, date), [data, date]);
  const derivedToday = useMemo(() => computeAll(data, today), [data, today]);

  const range = useMemo(() => {
    let min = today, max = today;
    for (const p of data.projects) { if (p.startDate && p.startDate < min) min = p.startDate; if (p.endDate && p.endDate > max) max = p.endDate; }
    for (const s of data.segments) { if (s.history[0] && s.history[0].d < min) min = s.history[0].d; }
    for (const pd of derivedToday.proj.values()) if (pd.projectedFinish && pd.projectedFinish > max) max = pd.projectedFinish;
    if (daysBetween(today, max) > 900) max = addDays(today, 900);
    return { min, max: addDays(max, 7) };
  }, [data, derivedToday, today]);

  const projects = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return data.projects.filter((p) => {
      const d = derived.proj.get(p.id)!;
      if (q && !`${p.code} ${p.name} ${p.client ?? ""} ${p.region ?? ""}`.toLowerCase().includes(q)) return false;
      if (filters.rag.length && !filters.rag.includes(d.rag)) return false;
      if (filters.category && p.category !== filters.category) return false;
      if (filters.status && p.status !== filters.status) return false;
      if (filters.subs.length && !data.segments.some((s) => s.projectId === p.id && s.sub && filters.subs.includes(s.sub.id))) return false;
      if (filters.resp && !data.segments.some((s) => s.projectId === p.id && s.delays.some((e) => e.resp === filters.resp && e.d <= date)) && !data.issues.some((i) => i.projectId === p.id && i.resp === filters.resp)) return false;
      return true;
    });
  }, [data, derived, filters, date]);
  const projIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const segments = useMemo(() => data.segments.filter((s) => projIds.has(s.projectId)), [data, projIds]);
  const kpis = useMemo(() => computeKpis(projects, segments, derived), [projects, segments, derived]);
  const partiesAll = useMemo(() => computeParties(data, projIds, date), [data, projIds, date]);
  const partiesProj = useMemo(() => (selProject ? computeParties(data, new Set([selProject]), date) : []), [data, selProject, date]);
  const hlSegs = useMemo(() => {
    if (!highlight) return null;
    const p = [...partiesAll, ...partiesProj].find((x) => x.key === highlight);
    return new Set(p?.segKeys ?? []);
  }, [highlight, partiesAll, partiesProj]);
  const usedSubs = useMemo(() => new Set(segments.flatMap((s) => (s.sub ? [s.sub.id] : []))), [segments]);

  const colorOf = useCallback((s: OpsSegment): string => {
    const d = derived.seg.get(s.key)!;
    switch (mode) {
      case "sub": return subColor(data.subs, s.sub?.id ?? null);
      case "cause": return RESP_COLOR[d.dominantCause] ?? SELF_COLOR;
      case "cost": return costColor(d.cpi);
      case "stale": return d.status === "completed" ? "#8B5CF6" : stalenessColor(d.staleDays);
      default: return STATUS_COLOR[d.status];
    }
  }, [derived, mode, data.subs]);

  const dimOf = useCallback((s: OpsSegment): DimLevel => {
    const d = derived.seg.get(s.key)!;
    let lvl: DimLevel = 0;
    if (hlSegs) lvl = hlSegs.has(s.key) ? 0 : 2;
    else if (filters.subs.length && !(s.sub && filters.subs.includes(s.sub.id))) lvl = 2;
    else if (filters.resp && !(d.delayByResp[filters.resp] > 0 || d.openIssues.some((i) => i.resp === filters.resp))) lvl = 2;
    if (lvl === 0 && emphasis) {
      const ok = emphasis === "completed" ? d.status === "completed" : emphasis === "lag" ? d.plannedPct - d.actualPct > 1 : d.status === "at_risk" || d.status === "behind";
      if (!ok) lvl = 2;
    }
    if (lvl === 0 && selProject && s.projectId !== selProject) lvl = 1;
    return lvl;
  }, [derived, hlSegs, filters, emphasis, selProject]);

  const projectBadge = useCallback((p: OpsProject) => { const d = derived.proj.get(p.id)!; return { color: RAG_COLOR[d.rag], label: `${d.actualPct.toFixed(0)}%` }; }, [derived]);

  const visibleIssues = useMemo(() => data.issues.filter((i) => projIds.has(i.projectId) && i.status !== "closed" && i.raisedOn && i.raisedOn <= date && (!i.resolvedOn || i.resolvedOn > date)), [data.issues, projIds, date]);

  /* ---------- layout ---------- */
  useLayoutEffect(() => {
    const el = rootRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const drawerOpen = !narrow && !!selProject;
  const left = narrow ? GAP : railOpen ? GAP + RAIL_W + GAP : GAP + RAIL_MIN + GAP;
  const right = drawerOpen ? GAP + DRAWER_W + GAP : GAP;
  const pad = useMemo(() => ({ l: (narrow ? 20 : railOpen ? RAIL_W + 36 : RAIL_MIN + 36), r: drawerOpen ? DRAWER_W + 36 : 28, t: 150, b: narrow ? 210 : 130 }), [narrow, railOpen, drawerOpen]);
  const padRef = useRef(pad); padRef.current = pad;
  const selKeyRef = useRef<string | null>(null); selKeyRef.current = selKey;

  const fit = useCallback((b: [number, number, number, number] | null) => { if (b) setFocus({ bounds: b, nonce: ++nonce.current }); }, []);
  useEffect(() => {
    if ((initialProject || initialSeg) && (rootRef.current?.clientWidth ?? 9999) < AUTO_COLLAPSE_BELOW) { setRailOpen(false); setLegendOpen(false); }
    fit(unionBbox(data.projects));
    if (initialProject) { const p = data.projects.find((x) => x.id === initialProject); const t = setTimeout(() => fit(p?.bbox ?? null), 800); return () => clearTimeout(t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reposition = useCallback(() => {
    const el = cardRef.current, api = mapApi.current;
    const a = anchor.current ?? (selKeyRef.current ? data.segments.find((x) => x.key === selKeyRef.current)?.mid ?? null : null);
    if (!el || !api || !a) return;
    const pt = api.project(a), size = api.size();
    const cw = el.offsetWidth, ch = el.offsetHeight;
    const minX = (narrow ? GAP : railOpen ? RAIL_W + 2 * GAP : GAP + RAIL_MIN + GAP), maxX = size.x - (drawerOpen ? DRAWER_W + 2 * GAP : GAP);
    const minY = 196, maxY = size.y - ch - 128;
    const clampY = (v: number) => Math.max(minY, Math.min(v, maxY));
    // Prefer beside the anchor (right, then left) so the card never covers the selected segment; fall back to above/below.
    let x = pt.x + 24, y = clampY(pt.y - ch / 3);
    if (x + cw > maxX) x = pt.x - 24 - cw;
    if (x < minX) {
      const cx = Math.max(minX, Math.min(pt.x - cw / 2, maxX - cw));
      const below = pt.y + 28, above = pt.y - 28 - ch;
      y = below <= maxY ? below : above >= minY ? above : clampY(below);
      x = cx;
    }
    x = Math.max(minX, Math.min(x, maxX - cw));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }, [narrow, railOpen, drawerOpen, data.segments]);
  const repositionRef = useRef(reposition); repositionRef.current = reposition;
  useLayoutEffect(() => { if (selKey) { reposition(); const t = setTimeout(reposition, 80); return () => clearTimeout(t); } }, [selKey, reposition, width, date]);

  /* ---------- actions ---------- */
  const selectProject = useCallback((id: number | null, flyTo = true) => {
    setSelProject(id); setSelKey(null); setHighlight(null); anchor.current = null;
    if (id !== null) {
      if ((rootRef.current?.clientWidth ?? 9999) < AUTO_COLLAPSE_BELOW) { setRailOpen(false); setLegendOpen(false); } setSheetTab("details"); setSheetOpen(true); if (flyTo) fit(data.projects.find((p) => p.id === id)?.bbox ?? null); }
  }, [data.projects, fit]);
  const selectSeg = useCallback((key: string | null, ll?: L.LatLngExpression, fly = false) => {
    setSelKey(key);
    if (!key) return;
    const s = data.segments.find((x) => x.key === key)!;
    anchor.current = ll ?? s.mid;
    setSelProject((p) => p ?? s.projectId);
    if ((rootRef.current?.clientWidth ?? 9999) < AUTO_COLLAPSE_BELOW) { setRailOpen(false); setLegendOpen(false); }
    setSheetTab("details"); setSheetOpen(true);
    if (fly) fit(s.bbox);
  }, [data.segments, fit]);
  const clearAll = useCallback(() => { setSelKey(null); setHighlight(null); anchor.current = null; }, []);
  const reset = useCallback(() => { setSelProject(null); setSelKey(null); setHighlight(null); setEmphasis(null); setFilters(EMPTY_FILTERS); fit(unionBbox(data.projects)); }, [data.projects, fit]);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current; if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // time machine playback (≈ 1 week per 150 ms at 1×)
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setDate((d) => {
        const n = addDays(d, 7);
        if (n >= range.max) { setPlaying(false); return range.max; }
        return n;
      });
    }, 150 / speed);
    return () => clearInterval(t);
  }, [playing, speed, range.max]);
  const togglePlay = useCallback(() => { setPlaying((p) => { if (!p && date >= range.max) setDate(range.min); return !p; }); }, [date, range]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = tag === "INPUT" && (t as HTMLInputElement).type !== "range" && (t as HTMLInputElement).type !== "checkbox" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (selKey) setSelKey(null); else if (highlight) setHighlight(null); else if (emphasis) setEmphasis(null); else if (selProject) setSelProject(null);
      } else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else if (e.key === "ArrowLeft") { e.preventDefault(); setDate((d) => (addDays(d, -7) < range.min ? range.min : addDays(d, -7))); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setDate((d) => (addDays(d, 7) > range.max ? range.max : addDays(d, 7))); }
      else if (e.key === " " && tag !== "BUTTON" && tag !== "A") { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selKey, highlight, emphasis, selProject, range, toggleFullscreen, togglePlay]);

  // URL state. Debounced and skipped while the time machine plays: browsers (Safari) throw a SecurityError
  // after 100 history.replaceState calls in 10 s, which playback / slider scrubbing would otherwise exceed.
  useEffect(() => {
    if (playing) return;
    const t = setTimeout(() => {
      const u = new URL(window.location.href);
      const set = (k: string, v: string | null) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
      set("project", selProject ? String(selProject) : null);
      set("segment", selKey);
      set("color", mode !== "health" ? mode : null);
      set("date", date !== today ? date : null);
      set("sub", filters.subs.length ? filters.subs.join(",") : null);
      const next = u.toString();
      if (next === window.location.href) return;
      try { window.history.replaceState(window.history.state, "", next); } catch { /* rate-limited by the browser: the URL is only a convenience */ }
    }, 400);
    return () => clearTimeout(t);
  }, [selProject, selKey, mode, date, filters.subs, today, playing]);
  const share = () => { void navigator.clipboard?.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); };

  const basemap: Basemap = sat ? "sat" : night ? "dark" : "light";
  const selSeg = selKey ? data.segments.find((s) => s.key === selKey) ?? null : null;
  const selProj = selProject ? data.projects.find((p) => p.id === selProject) ?? null : null;
  const portalUrl = (s: OpsSegment) => (!clientMode && s.portalToken && typeof window !== "undefined" ? `${window.location.origin}/portal/${s.portalToken}` : null);
  const pickIssue = (i: OpsIssue) => { const k = i.segKeys[0]; if (k) selectSeg(k, [i.lat, i.lng]); else selectProject(i.projectId); };
  const worst = () => { const p = projects.find((x) => x.code === kpis.worstProject); if (p) selectProject(p.id); };

  const cardEl = selSeg && derived.seg.get(selSeg.key) && (
    <SegmentCard seg={selSeg} d={derived.seg.get(selSeg.key)!} color={colorOf(selSeg)} projectCode={data.projects.find((p) => p.id === selSeg.projectId)?.code ?? ""} portalUrl={portalUrl(selSeg)} client={clientMode} onClose={() => setSelKey(null)} />
  );
  const drawerEl = selProj && (
    <ProjectDrawer project={selProj} data={data} segs={data.segments.filter((s) => s.projectId === selProj.id)} derived={derived} parties={partiesProj} highlight={highlight} onHighlight={setHighlight}
      colorOf={colorOf} selectedKey={selKey} onSelectSeg={(k) => selectSeg(k, undefined, true)} onClose={() => selectProject(null)} bare={narrow} client={clientMode}
      onPickSub={(id) => setFilters((f) => ({ ...f, subs: f.subs.includes(id) ? f.subs.filter((x) => x !== id) : [id] }))} />
  );
  const railEl = (
    <ProjectsRail hideSubs={!!clientMode && !clientMode.showSubs} data={data} derived={derived} projects={projects} filters={filters} setFilters={setFilters} selected={selProject} onSelect={(id) => selectProject(id)} onCollapse={() => (narrow ? setSheetOpen(false) : setRailOpen(false))} />
  );

  const rootStyle = initial.embed ? "fixed inset-0 z-[2000]" : clientMode ? "fixed bottom-[56px] left-0 right-0 top-16 z-[40] md:bottom-0 md:left-[248px]" : "fixed bottom-0 left-0 right-0 top-[105px] z-[40] md:left-[248px] md:top-16";
  const sheetH = sheetOpen ? "min(48%, 340px)" : "46px";

  return (
    <div ref={rootRef} className={`om-root ${rootStyle}`} data-night={night ? "1" : "0"} data-bm={basemap} data-testid="ops-map"
      onMouseUp={(e) => { const b = (e.target as HTMLElement).closest("button"); if (b && e.detail > 0) b.blur(); }}>
      <div className="absolute inset-0">
        <MapCanvas
          data={data} derived={derived} segments={segments} projects={projects} issues={visibleIssues} colorOf={colorOf} dimOf={dimOf} projectBadge={projectBadge}
          basemap={basemap} night={night || sat} compare={compare} selectedKey={selKey} selectedProject={selProject} focus={focus} pad={padRef.current}
          resizeTick={`${railOpen}-${drawerOpen}-${narrow}-${fullscreen}`}
          onSelectSeg={(k, ll) => selectSeg(k, ll)} onClear={clearAll} onPickProject={(id) => selectProject(id)} onPickIssue={pickIssue} onMove={() => repositionRef.current()} api={mapApi}
        />
      </div>

      {/* top: KPI strip + colour-by + tools */}
      <div className="pointer-events-none absolute z-[1001] flex flex-col gap-2" style={{ top: GAP, left, right }}>
        <div className="pointer-events-auto"><KpiStrip k={kpis} emphasis={emphasis} setEmphasis={setEmphasis} onWorst={worst} hideCost={!!clientMode} /></div>
        <div className={`pointer-events-auto flex items-center justify-between gap-2 ${narrow ? "om-hscroll" : "flex-wrap"}`}>
          <ColorSwitch mode={mode} onChange={setMode} modes={MODES} />
          <Tools night={night} onNight={() => setNight(!night)} basemap={basemap} onBasemap={() => setSat(!sat)} compare={compare} onCompare={() => setCompare(!compare)}
            fullscreen={fullscreen} onFullscreen={toggleFullscreen} onReset={reset} onShare={share} copied={copied} onZoom={(d) => (d > 0 ? mapApi.current?.zoomIn() : mapApi.current?.zoomOut())} />
        </div>
      </div>

      {/* left rail */}
      {!narrow && railOpen && <div className="om-pop absolute z-[1001]" style={{ left: GAP, top: GAP, bottom: GAP, width: RAIL_W }}>{railEl}</div>}
      {!narrow && !railOpen && (
        <button type="button" className="om-btn om-glass absolute z-[1001] !h-10 !rounded-xl" style={{ left: GAP, top: GAP, width: RAIL_MIN }} onClick={() => setRailOpen(true)} aria-label="Open projects panel" title="Projects"><PanelLeftOpen size={15} /><span className="om-chip">{projects.length}</span></button>
      )}

      {/* right drawer */}
      {drawerOpen && selProj && <div className="absolute z-[1001]" style={{ right: GAP, top: GAP, bottom: GAP, width: DRAWER_W }} key={selProj.id}>{drawerEl}</div>}

      {/* anchored segment card (wide) */}
      {!narrow && cardEl && <div ref={cardRef} className="absolute left-0 top-0 z-[1002] flex w-[344px] flex-col" style={{ maxHeight: "calc(100% - 330px)", transform: "translate(-999px,-999px)" }}>{cardEl}</div>}

      {/* bottom: legend + time machine + attribution */}
      <div className="pointer-events-none absolute z-[1001] flex flex-col gap-2" style={{ left, right, bottom: narrow ? `calc(${sheetH} + 8px)` : 20 }}>
        {!narrow && <div className="pointer-events-auto self-start"><Legend mode={mode} subs={data.subs} usedSubs={usedSubs} forecast={derived.forecast} open={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} /></div>}
        {!(narrow && sheetOpen) && <div className="pointer-events-auto"><TimeMachine compact={narrow} attribution={ATTRIBUTION[basemap]} date={date} min={range.min} max={range.max} today={today} playing={playing} speed={speed} onDate={(d) => { setPlaying(false); setDate(d); }} onPlay={togglePlay} onSpeed={setSpeed} /></div>}
      </div>
      <div className="absolute bottom-0 z-[1001] rounded-tr-lg px-2 py-px text-[9.5px] font-semibold" style={{ left: narrow ? 0 : left - GAP, background: "var(--om-glass)", color: "var(--om-muted)", display: narrow ? "none" : "block" }}>{ATTRIBUTION[basemap]} · Leaflet</div>

      {/* narrow: bottom sheet with tabs */}
      {narrow && (
        <div className="om-glass absolute inset-x-0 bottom-0 z-[1003] flex flex-col overflow-hidden transition-[height] duration-300" style={{ height: sheetH, borderRadius: "18px 18px 0 0" }}>
          <div className="flex items-center gap-1 px-2 pt-1.5">
            <div className="om-seg flex-1 justify-between !shadow-none">
              {([["projects", "Projects"], ["details", "Details"], ["delays", "Delays"]] as const).map(([k, l]) => (
                <button key={k} type="button" className="flex-1" aria-pressed={sheetTab === k} onClick={() => { setSheetTab(k); setSheetOpen(true); }}>{l}</button>
              ))}
            </div>
            <button type="button" className="om-btn !h-8 !w-8 !px-0" onClick={() => setSheetOpen(!sheetOpen)} aria-label={sheetOpen ? "Collapse panel" : "Expand panel"}><ChevronUp size={15} style={{ transform: sheetOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} /></button>
          </div>
          {sheetOpen && (
            <div className="om-scroll min-h-0 flex-1 p-2">
              {sheetTab === "projects" && <div className="h-full">{railEl}</div>}
              {sheetTab === "details" && (cardEl ?? drawerEl ?? (
                <div className="space-y-3 p-2"><div className="om-muted text-center text-xs font-semibold"><Layers size={16} className="mx-auto mb-1" />Tap a project or segment on the map for details.</div><Legend mode={mode} subs={data.subs} usedSubs={usedSubs} forecast={derived.forecast} open onToggle={() => undefined} /></div>
              ))}
              {sheetTab === "delays" && (
                <div className="p-2"><h3 className="om-h mb-2">{selProj ? `Delay causes · ${selProj.code}` : "Delay causes · portfolio"}</h3><DelayChart parties={selProj ? partiesProj : partiesAll} highlight={highlight} onHighlight={setHighlight} /></div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

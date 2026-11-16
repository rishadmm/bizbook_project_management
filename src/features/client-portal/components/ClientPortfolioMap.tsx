"use client";
import "../../ops-map/ops-map.css";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { computeAll, STATUS_COLOR, STATUS_LABEL } from "@/features/ops-map/calc";
import type { MapApi, Focus } from "@/features/ops-map/components/MapCanvas";
import { RAG_COLOR } from "@/features/ops-map/components/bits";
import { hydrateClientMap, type ClientMapPayload } from "../map-payload";

const MapCanvas = dynamic(() => import("@/features/ops-map/components/MapCanvas"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">Loading map…</div> });

/**
 * Embedded map of the client portal (dashboard: all of the client's projects, project page: one project). Reuses the Live Ops Map canvas with the
 * client-safe payload only; colours = schedule health, plan-vs-actual markers on. Click a section for its status, a project badge to open the project.
 */
export default function ClientPortfolioMap({ payload, projectId, height = 380 }: { payload: ClientMapPayload; projectId?: number; height?: number }) {
  const router = useRouter();
  const base = payload.base;
  const data = useMemo(() => {
    const d = hydrateClientMap(payload);
    if (!projectId) return d;
    const segments = d.segments.filter((s) => s.projectId === projectId);
    const keys = new Set(segments.map((s) => s.key));
    return { ...d, projects: d.projects.filter((p) => p.id === projectId), segments, issues: d.issues.filter((i) => i.projectId === projectId && i.segKeys.some((k) => keys.has(k))) };
  }, [payload, projectId]);
  const derived = useMemo(() => computeAll(data, data.today), [data]);
  const api = useRef<MapApi | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const focus = useMemo<Focus | null>(() => {
    if (!data.projects.length) return null;
    const b = data.projects.reduce<[number, number, number, number]>((a, p) => [Math.min(a[0], p.bbox[0]), Math.min(a[1], p.bbox[1]), Math.max(a[2], p.bbox[2]), Math.max(a[3], p.bbox[3])], [...data.projects[0].bbox]);
    return { bounds: b, nonce: 1 };
  }, [data.projects]);
  const seg = sel ? data.segments.find((s) => s.key === sel) : null;
  const sd = seg ? derived.seg.get(seg.key) : null;
  if (!data.segments.length) return <p className="p-5 text-sm text-slate-400">No mapped sections yet.</p>;
  return (
    <div className="om-root relative w-full" data-night="0" data-bm="light" data-testid="client-map" style={{ height }}>
      <div className="absolute inset-0">
        <MapCanvas data={data} derived={derived} segments={data.segments} projects={data.projects} issues={[]} colorOf={(s) => STATUS_COLOR[derived.seg.get(s.key)!.status]} dimOf={() => 0}
          projectBadge={(p) => { const d = derived.proj.get(p.id)!; return { color: RAG_COLOR[d.rag], label: `${d.actualPct.toFixed(0)}%` }; }}
          basemap="light" night={false} compare selectedKey={sel} selectedProject={null} focus={focus} pad={{ l: 24, r: 24, t: 24, b: 24 }} resizeTick="embedded"
          onSelectSeg={(k) => setSel(k)} onClear={() => setSel(null)} onPickProject={(id) => router.push(`${base}/projects/${id}`)} onPickIssue={() => undefined} onMove={() => undefined} api={api} />
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 z-[1001] flex flex-wrap gap-1.5 text-[11px] font-bold">
        {(["on_track", "at_risk", "behind", "not_started", "completed"] as const).map((k) => (
          <span key={k} className="om-glass pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1"><i className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[k] }} />{STATUS_LABEL[k]}</span>
        ))}
      </div>
      {seg && sd && (
        <div className="om-glass absolute right-2 top-2 z-[1002] w-[min(18rem,calc(100%-1rem))] rounded-2xl p-3 text-sm" data-testid="client-map-card">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><div className="truncate font-extrabold">{seg.stageCode ? `${seg.stageCode} · ` : ""}{seg.stageName}</div><div className="om-muted truncate text-xs font-semibold">{data.projects.find((p) => p.id === seg.projectId)?.code}{seg.sub ? ` · ${seg.sub.name}` : ""}</div></div>
            <button type="button" aria-label="Close" onClick={() => setSel(null)} className="om-btn !h-6 !w-6 !px-0">×</button>
          </div>
          <div className="mt-2 flex items-end justify-between"><span className="text-xl font-extrabold" style={{ color: STATUS_COLOR[sd.status] }}>{sd.actualPct.toFixed(0)}%</span><span className="om-muted text-xs font-bold">plan {sd.plannedPct.toFixed(0)}% · {STATUS_LABEL[sd.status]}</span></div>
          <div className="mt-2 flex items-center justify-between text-xs"><span className="om-muted font-semibold">Projected end</span><b>{sd.projectedEnd}</b></div>
          <Link href={`${base}/map?project=${seg.projectId}&segment=${seg.key}`} className="mt-2 inline-block text-xs font-extrabold" style={{ color: "var(--om-primary)" }}>Open in live map →</Link>
        </div>
      )}
    </div>
  );
}

"use client";
import dynamic from "next/dynamic";
import type { ProjectMapProps } from "./types";

export type { MapFeature, MapLegendItem, ProjectMapProps } from "./types";

const Loading = () => <div className="flex h-64 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500">Loading map…</div>;

/**
 * Client-only Leaflet map (SSR disabled). Import `ProjectMapLazy` (alias `ProjectMap`) from server or client components.
 * See ./types.ts for props (features, editable, onSave, drawKind, center, zoom, height, legend).
 * Note: `onSave` is a function prop, so it must be passed from a client component wrapper (or be a server action).
 */
export const ProjectMapLazy = dynamic<ProjectMapProps>(() => import("./ProjectMapInner"), { ssr: false, loading: Loading });
export const ProjectMap = ProjectMapLazy;

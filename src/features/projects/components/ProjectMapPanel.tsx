"use client";
import { useState } from "react";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { ProjectMapLazy } from "@/components/map/ProjectMap";
import type { MapFeature, MapLegendItem } from "@/components/map/types";
import { buttonClass } from "@/components/ui/Button";
import { saveMapGeometry } from "../actions";

/** Project map. In edit mode saves drawn/edited shapes through the saveMapGeometry server action. */
export default function ProjectMapPanel({ projectId, features, legend, editable, center }: {
  projectId: number; features: MapFeature[]; legend: MapLegendItem[]; editable: boolean; center?: [number, number];
}) {
  const [kind, setKind] = useState<"project" | "stage">("project");
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/projects/${projectId}?tab=map`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {editable ? (
          <>
            <Link href={base} className={buttonClass("secondary", "sm")}>Exit edit mode</Link>
            <div className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
              <span className="text-xs font-medium text-slate-500">New shapes are</span>
              <label className="flex items-center gap-1"><input type="radio" checked={kind === "project"} onChange={() => setKind("project")} />project route / area</label>
              <label className="flex items-center gap-1"><input type="radio" checked={kind === "stage"} onChange={() => setKind("stage")} />new stage</label>
            </div>
            <span className="text-xs text-slate-500">Draw with the toolbar, edit vertices, then press Save on the map. Save before switching shape type (switching clears unsaved shapes).</span>
          </>
        ) : (
          <Link href={`${base}&edit=1`} className={buttonClass("secondary", "sm")}><Pencil size={13} className="mr-1" />Edit map</Link>
        )}
        {msg && <span className="text-xs font-medium text-emerald-700">{msg}</span>}
      </div>
      <ProjectMapLazy
        key={editable ? `edit-${kind}` : "view"}
        features={features} legend={legend} height={560} center={center}
        editable={editable} drawKind={kind}
        onSave={editable ? async (fc) => {
          const r = await saveMapGeometry(projectId, fc);
          setMsg(`Saved: route ${r.projectUpdated ? "updated" : "unchanged"}, ${r.updatedStages} stage shape(s) updated, ${r.createdStages} stage(s) created.`);
        } : undefined}
      />
    </div>
  );
}

import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { splitRouteAtChainages, splitRouteEqual } from "../actions";

/** "Split route into N equal stages" and "split at chainages (km list)" forms. */
export default function SplitTools({ projectId, routeKm, hasStages }: { projectId: number; routeKm: number | null; hasStages: boolean }) {
  if (routeKm === null) return <p className="text-sm text-slate-500">Splitting needs a polyline route. Draw the project route first (Map tab, Edit map).</p>;
  const replace = (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      <input type="checkbox" name="replace" /> Replace existing stages{hasStages ? " (only if none has progress or subcontracts)" : ""}
    </label>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form action={splitRouteEqual} className="space-y-3 rounded-lg border border-slate-200 p-3">
        <input type="hidden" name="project_id" value={projectId} />
        <div className="text-sm font-medium text-slate-800">Split route into N equal stages</div>
        <p className="text-xs text-slate-500">Route length {routeKm.toFixed(2)} km. Stages get geometry, chainage, planned quantity and dates spread across the project duration.</p>
        <Field label="Number of stages"><Input name="n" type="number" min="2" max="100" defaultValue="5" required /></Field>
        {replace}
        <Button type="submit" variant="primary" size="sm">Create stages</Button>
      </form>
      <form action={splitRouteAtChainages} className="space-y-3 rounded-lg border border-slate-200 p-3">
        <input type="hidden" name="project_id" value={projectId} />
        <div className="text-sm font-medium text-slate-800">Split at chainages (km)</div>
        <p className="text-xs text-slate-500">Cut points between 0 and {routeKm.toFixed(2)} km, e.g. <code>5, 12.5, 20</code> makes 4 stages.</p>
        <Field label="Chainages (km)"><Input name="chainages" placeholder="5, 12.5, 20" required /></Field>
        {replace}
        <Button type="submit" variant="primary" size="sm">Create stages</Button>
      </form>
    </div>
  );
}

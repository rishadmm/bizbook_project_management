// Sanity checks for calc.ts. Run: npx tsx src/features/ops-map/calc.check.ts
import assert from "node:assert/strict";
import { addDays, daysBetween } from "@/lib/format";
import { buildLine, computeSegment, pointAt, sliceLine } from "./calc";
import type { HistPt, OpsSegment } from "./types";

function seg(over: Partial<OpsSegment> = {}, history: HistPt[] = []): OpsSegment {
  return {
    key: "a1", assignmentId: 1, projectId: 1, stageId: 1, stageCode: "S1", stageName: "Stage", chainFrom: 0, chainTo: 1, sub: { id: 1, name: "Sub", rating: 4, trade: null },
    scope: null, assignmentStatus: "active", contractValue: 1000, qty: 100, unit: "km", planQty: 100, kind: "line", coords: [[55, 25], [55.1, 25]], rings: null, lengthKm: 10,
    bbox: [55, 25, 55.1, 25], mid: [25, 55.05], plannedStart: "2026-01-01", plannedEnd: "2026-04-11", weight: 1, shared: null, history,
    delays: [], invoices: { claimed: 0, certified: 0, paid: 0 }, portalToken: null, ...over,
  };
}
const weekly = (from: string, n: number, step: number): HistPt[] => Array.from({ length: n }, (_, i) => ({ d: addDays(from, 7 * i), pct: step * (i + 1), qty: step * (i + 1), mp: 10 }));

// 1. projected completion from the recent rate (5 %/wk): 4 weeks reported ending 2026-03-01 -> 20 %, 16 weeks to go
{
  const h = weekly("2026-02-09", 4, 5); // 02-09..03-02 -> 5,10,15,20
  const d = computeSegment(seg({}, h), "2026-03-02", "2026-03-02");
  assert.equal(Math.round(d.actualPct), 20);
  assert.equal(d.projectedEnd, addDays("2026-03-02", 112));
  assert.equal(d.slipDays, daysBetween("2026-04-11", d.projectedEnd));
  assert.equal(d.status, "behind");
  assert.ok(d.slipDays > 14);
  assert.ok(!d.forecast);
}
// 2. status rule
{
  const planned = 100 / 100; // linear 100-day plan; at 2026-02-20 (50 d) planned = 50 %
  void planned;
  const mk = (pct: number, lastD = "2026-02-20") => computeSegment(seg({}, [{ d: addDays("2026-01-01", 0), pct: 0, qty: 0, mp: 0 }, { d: "2026-02-13", pct: pct * 0.7, qty: 0, mp: 5 }, { d: lastD, pct, qty: 0, mp: 5 }]), "2026-02-20", "2026-02-20");
  assert.equal(mk(50).status, "on_track");
  assert.equal(mk(40).status, "behind"); // spi 0.8
  assert.ok(["at_risk", "behind"].includes(mk(47).status)); // spi 0.94 -> at risk (or slip>14 -> behind)
  const stale = computeSegment(seg({}, [{ d: "2026-01-10", pct: 5, qty: 0, mp: 5 }, { d: "2026-02-01", pct: 50, qty: 0, mp: 5 }]), "2026-02-20", "2026-02-20");
  assert.equal(stale.staleDays, 19);
  assert.notEqual(stale.status, "on_track");
  assert.equal(computeSegment(seg({}, []), "2025-12-01", "2025-12-01").status, "not_started");
  assert.equal(computeSegment(seg({}, [{ d: "2026-02-01", pct: 100, qty: 0, mp: 3 }]), "2026-03-01", "2026-03-01").status, "completed");
  assert.equal(computeSegment(seg({ assignmentStatus: "suspended" }, [{ d: "2026-02-01", pct: 20, qty: 0, mp: 3 }]), "2026-02-20", "2026-02-20").status, "suspended");
}
// 3. completed: actual end date is the first report at >= 99.5 %
{
  const d = computeSegment(seg({}, [{ d: "2026-02-01", pct: 60, qty: 0, mp: 3 }, { d: "2026-03-20", pct: 100, qty: 0, mp: 3 }, { d: "2026-04-01", pct: 100, qty: 0, mp: 3 }]), "2026-05-01", "2026-05-01");
  assert.equal(d.projectedEnd, "2026-03-20");
  assert.equal(d.endedOn, "2026-03-20");
  assert.equal(d.slipDays, daysBetween("2026-04-11", "2026-03-20")); // finished early => negative slip
}
// 4. time machine: past replays history, future extrapolates (forecast flag)
{
  const h = weekly("2026-02-09", 4, 5);
  assert.equal(Math.round(computeSegment(seg({}, h), "2026-02-16", "2026-03-02").actualPct), 10);
  const f = computeSegment(seg({}, h), "2026-03-30", "2026-03-02");
  assert.ok(f.forecast && f.actualPct > 20 && f.actualPct <= 100, `forecast pct ${f.actualPct}`);
  assert.equal(Math.round(f.actualPct), 40); // 4 more weeks at 5 %/wk
}
// 5. no rate fallback: planned end + current lag
{
  const d = computeSegment(seg({}, [{ d: "2026-01-10", pct: 10, qty: 0, mp: 1 }]), "2026-01-10", "2026-01-10");
  assert.ok(d.projectedEnd >= "2026-01-10");
}
// 6. geometry slicing
{
  const line = buildLine([[55, 25], [55.05, 25], [55.1, 25]]);
  const half = sliceLine(line, 0, 0.5);
  const last = half[half.length - 1];
  assert.ok(Math.abs(last[1] - 55.05) < 1e-6, `half lng ${last[1]}`);
  const p = pointAt(line, 0.25);
  assert.ok(Math.abs(p.lng - 55.025) < 1e-6);
  assert.ok(Math.abs(p.bearing - 90) < 1);
  const tail = sliceLine(line, 0.75, 1);
  assert.ok(Math.abs(tail[0][1] - 55.075) < 1e-6 && Math.abs(tail[tail.length - 1][1] - 55.1) < 1e-6);
}
console.log("calc.check: all assertions passed");

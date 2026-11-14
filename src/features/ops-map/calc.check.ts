// Sanity checks for calc.ts. Run: npx tsx src/features/ops-map/calc.check.ts
import assert from "node:assert/strict";
import { addDays, daysBetween } from "@/lib/format";
import { buildLine, computeProject, computeSegment, pointAt, sliceLine } from "./calc";
import type { HistPt, OpsProject, OpsSegment, SegDerived } from "./types";

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
// 7. forecast mode (asOf > today): projected outcome drives RAG, CPI stays at today's value, late segments stay flagged until they complete
{
  const TODAY = "2026-03-02";
  const proj = (over: Partial<OpsProject> = {}): OpsProject => ({
    id: 1, code: "P", name: "P", client: null, category: "road", status: "active", parentId: null, region: null, bbox: [55, 25, 55.1, 25], contractValue: 2000, bac: 1000, ac: 300,
    startDate: "2026-01-01", endDate: "2026-04-11", totalQty: 100, unit: "km", lengthKm: 10, forecastFinish: null, acHistory: [{ d: "2026-02-01", cum: 300 }], managerName: null, ...over,
  });
  const run = (segs: OpsSegment[], pr: OpsProject, asOf: string) => {
    const m = new Map<string, SegDerived>();
    for (const s of segs) m.set(s.key, computeSegment(s, asOf, TODAY, []));
    return computeProject(pr, segs, m, asOf, TODAY, []);
  };
  const FUT = "2028-01-05";
  // late: 20 % at today vs 50 % planned (5 %/wk -> finishes ~14 weeks late)
  const late = seg({}, weekly("2026-02-09", 4, 5));
  const lateNow = run([late], proj(), TODAY);
  const lateFut = run([late], proj(), FUT);
  assert.equal(lateNow.rag, "red");
  assert.equal(lateFut.rag, "red", "a late project never turns green in forecast");
  assert.ok(lateFut.delayDays > 30);
  assert.equal(lateFut.cpi, lateNow.cpi, "forecast CPI = today's CPI");
  assert.ok(lateFut.cpi !== null && lateFut.cpi < 1);
  // amber: projected 10 days late (<= 30)
  const amberSeg = seg({ plannedEnd: "2026-04-11" }, [{ d: "2026-02-09", pct: 10, qty: 10, mp: 5 }, { d: "2026-02-16", pct: 20, qty: 20, mp: 5 }, { d: "2026-02-23", pct: 30, qty: 30, mp: 5 }, { d: "2026-03-02", pct: 40, qty: 40, mp: 5 }]);
  const amberD = computeSegment(amberSeg, TODAY, TODAY, []);
  const slipA = amberD.slipDays;
  assert.ok(slipA > 0);
  const amberFut = run([amberSeg], proj({ endDate: addDays(amberD.projectedEnd, -10) }), FUT);
  assert.equal(amberFut.rag, "amber");
  // on time: projected on or before the contract end -> RAG as of today (green here: ahead of plan, cost fine)
  const okSeg = seg({}, [{ d: "2026-02-16", pct: 30, qty: 30, mp: 5 }, { d: "2026-03-02", pct: 60, qty: 60, mp: 5 }]);
  const okNow = run([okSeg], proj({ ac: 500, acHistory: [{ d: "2026-02-01", cum: 500 }] }), TODAY);
  const okFut = run([okSeg], proj({ ac: 500, acHistory: [{ d: "2026-02-01", cum: 500 }] }), FUT);
  assert.equal(okNow.rag, "green");
  assert.equal(okFut.delayDays, 0);
  assert.equal(okFut.rag, okNow.rag);
  // segment status in forecast: late segment is behind/at_risk until it completes, then completed
  const f1 = computeSegment(late, "2026-04-20", TODAY, []);
  assert.ok(f1.forecast && f1.status === "behind", `forecast status ${f1.status}`);
  const f2 = computeSegment(late, FUT, TODAY, []);
  assert.equal(f2.status, "completed");
  // past dates keep the old behaviour
  assert.equal(computeSegment(late, "2026-02-23", TODAY, []).forecast, false);
}
// 8. suspended segments: planned end + days stopped (min 14); slip is capped at 365 d; project RAG respects delay at every date
{
  const TODAY = "2026-03-02";
  const h = [{ d: "2026-02-09", pct: 5, qty: 5, mp: 5 }, { d: "2026-02-16", pct: 10, qty: 10, mp: 5 }];
  const sus = seg({ assignmentStatus: "suspended" }, h);
  const a = computeSegment(sus, TODAY, TODAY, []);
  assert.equal(a.status, "suspended");
  assert.equal(a.projectedEnd, addDays("2026-04-11", daysBetween("2026-02-16", TODAY)));
  assert.equal(a.slipDays, daysBetween("2026-02-16", TODAY));
  const fresh = computeSegment(seg({ assignmentStatus: "suspended" }, [{ d: "2026-03-01", pct: 10, qty: 10, mp: 5 }]), TODAY, TODAY, []);
  assert.equal(fresh.slipDays, 14, "at least 14 days");
  const f = computeSegment(sus, "2026-12-01", TODAY, []);
  assert.equal(f.status, "suspended");
  assert.ok(f.slipDays <= 365 && f.actualPct === 10, "no extrapolated progress while suspended");
  const tiny = computeSegment(seg({}, [{ d: "2026-03-02", pct: 0.05, qty: 0, mp: 1 }]), TODAY, TODAY, []);
  assert.ok(tiny.slipDays <= 365, `capped slip ${tiny.slipDays}`);
  const proj = (end: string): OpsProject => ({ id: 1, code: "P", name: "P", client: null, category: "road", status: "active", parentId: null, region: null, bbox: [55, 25, 55.1, 25], contractValue: 2000, bac: 1000, ac: 300,
    startDate: "2026-01-01", endDate: end, totalQty: 100, unit: "km", lengthKm: 10, forecastFinish: null, acHistory: [{ d: "2026-02-01", cum: 300 }], managerName: null });
  // healthy SPI/CPI but projected delay: 60 % at 02-16 -> end 04-11 vs contract end earlier
  const okSeg = seg({}, [{ d: "2026-02-16", pct: 30, qty: 30, mp: 5 }, { d: "2026-03-02", pct: 60, qty: 60, mp: 5 }]);
  const dd = computeSegment(okSeg, TODAY, TODAY, []);
  const run = (end: string) => { const m = new Map([[okSeg.key, dd]]); return computeProject(proj(end), [okSeg], m, TODAY, TODAY, []); };
  assert.equal(run(addDays(dd.projectedEnd, 5)).rag, "green");
  assert.equal(run(addDays(dd.projectedEnd, -45)).rag, "amber");
  assert.equal(run(addDays(dd.projectedEnd, -120)).rag, "red");
}
console.log("calc.check: all assertions passed");

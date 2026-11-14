"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/lib/format";
import { CHART } from "@/lib/theme";

/** Cumulative quantity: planned vs actual. */
export function QtyChart({ data, unit, today }: { data: { date: string; planned: number; actual: number | null }[]; unit: string; today: string }) {
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDate(d).slice(0, 6)} minTickGap={32} />
          <YAxis tick={{ fontSize: 11 }} width={48} unit={unit ? ` ${unit}` : ""} />
          <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}` : "—")} labelFormatter={(d) => formatDate(String(d))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine x={data.find((d) => d.date >= today)?.date} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "Today", fontSize: 10, fill: "#64748b" }} />
          <Line isAnimationActive={false} type="monotone" dataKey="planned" name="Planned" stroke="#94a3b8" strokeWidth={2} dot={false} />
          <Line isAnimationActive={false} type="stepAfter" dataKey="actual" name="Actual (verified)" stroke={CHART.actual} strokeWidth={2.5} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Weekly average headcount. */
export function ManpowerChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={1} />
          <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
          <Tooltip formatter={(v) => [`${v} workers`, "Avg headcount"]} />
          <Bar isAnimationActive={false} dataKey="value" name="Avg headcount" fill={CHART.actual} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

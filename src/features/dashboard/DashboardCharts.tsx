"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/lib/theme";

const compact = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v)));
const AXIS = { fontSize: 11, fill: "#64748b" };

export function FunnelChart({ data, currency }: { data: { label: string; count: number; value: number; color: string }[]; currency: string }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 56, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={CHART.grid} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={96} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v, _n, p) => [`${v} tenders · ${currency} ${compact(Number((p.payload as { value: number }).value))}`, "Pipeline"]} />
          <Bar isAnimationActive={false} dataKey="count" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "#334155", formatter: (v: unknown) => String(v) }}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BudgetActualChart({ data, currency }: { data: { name: string; budget: number; earned: number; actual: number }[]; currency: string }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="name" tick={{ ...AXIS, angle: -35, textAnchor: "end" }} interval={0} height={56} tickMargin={4} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} tickFormatter={compact} axisLine={false} tickLine={false} width={48} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => `${currency} ${compact(Number(v))}`} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="budget" name="Budget (BAC)" fill="#94a3b8" radius={[3, 3, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="earned" name="Earned value" fill={CHART.actual} radius={[3, 3, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="actual" name="Actual cost" fill={CHART.warning} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DelayChart({ data }: { data: { label: string; days: number; color: string }[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={CHART.grid} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={104} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(v) => [`${v} days`, "Delay"]} />
          <Bar isAnimationActive={false} dataKey="days" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "#334155" }}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

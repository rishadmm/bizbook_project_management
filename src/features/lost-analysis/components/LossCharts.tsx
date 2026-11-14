"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/lib/theme";

export interface BarDatum { name: string; value: number; color?: string }

export function LossBar({ data, unit = "", height = 200 }: { data: BarDatum[]; unit?: string; height?: number }) {
  if (!data.length) return <div className="py-10 text-center text-xs text-slate-400">No data</div>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, angle: -35, textAnchor: "end" }} interval={0} height={56} tickMargin={4} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} unit={unit} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(unit ? 1 : 0)}${unit}`} />
          <Bar isAnimationActive={false} dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={44}>{data.map((d, i) => <Cell key={i} fill={d.color ?? CHART.actual} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import { CHART } from "@/lib/theme";

export interface NegPoint { name: string; ours: number | null; target: number | null }

export function NegotiationChart({ data, currency }: { data: NegPoint[]; currency: string }) {
  const money = (v: unknown) => formatMoney(Number(v), { currency });
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatMoney(Number(v), { currency, compact: true })} width={90} />
          <Tooltip formatter={money} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="ours" name="Our price" fill={CHART.actual} radius={[3, 3, 0, 0]} maxBarSize={48} />
          <Line isAnimationActive={false} dataKey="target" name="Client target" stroke={CHART.negative} strokeWidth={2} dot={{ r: 4 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

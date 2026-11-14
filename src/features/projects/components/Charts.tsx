"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactNumber, formatDate } from "@/lib/format";
import { CHART } from "@/lib/theme";

const BLUE = CHART.actual, SLATE = "#94a3b8", GREEN = CHART.positive, RED = CHART.negative;

export function SCurveChart({ data, today }: { data: { date: string; planned: number; actual: number | null }[]; today: string }) {
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDate(d).slice(0, 6)} minTickGap={32} />
          <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" width={40} />
          <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")} labelFormatter={(d) => formatDate(String(d))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine x={data.find((d) => d.date >= today)?.date} stroke={SLATE} strokeDasharray="4 4" label={{ value: "Today", fontSize: 10, fill: "#64748b" }} />
          <Line isAnimationActive={false} type="monotone" dataKey="planned" name="Planned" stroke={SLATE} strokeWidth={2} dot={false} />
          <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual" stroke={BLUE} strokeWidth={2.5} dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BudgetActualChart({ data, currency, labelKey = "label" }: { data: { label: string; budget: number; actual: number }[]; currency: string; labelKey?: string }) {
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis dataKey={labelKey} tick={{ fontSize: 11, angle: -35, textAnchor: "end" }} interval={0} height={56} tickMargin={4} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => compactNumber(v)} width={52} />
          <Tooltip formatter={(v) => (typeof v === "number" ? `${currency} ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—")} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar isAnimationActive={false} dataKey="budget" name="Budget" fill={SLATE} radius={[3, 3, 0, 0]} />
          <Bar isAnimationActive={false} dataKey="actual" name="Actual" fill={BLUE} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DelayBarChart({ data, valueLabel, color = RED, currency }: { data: { label: string; value: number }[]; valueLabel: string; color?: string; currency?: string }) {
  return (
    <div style={{ width: "100%", height: Math.max(180, data.length * 38 + 40) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => (currency ? compactNumber(v) : String(v))} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={110} />
          <Tooltip formatter={(v) => (typeof v === "number" ? (currency ? `${currency} ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `${v.toFixed(1)} ${valueLabel}`) : "—")} />
          <Bar isAnimationActive={false} dataKey="value" name={valueLabel} fill={color} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StageHistoryChart({ data }: { data: { date: string; percent: number; quantity: number }[] }) {
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDate(d).slice(0, 6)} minTickGap={28} />
          <YAxis yAxisId="l" tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" width={40} />
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} width={44} />
          <Tooltip labelFormatter={(d) => formatDate(String(d))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line isAnimationActive={false} yAxisId="l" type="monotone" dataKey="percent" name="Cumulative %" stroke={BLUE} strokeWidth={2.5} dot={{ r: 2 }} />
          <Line isAnimationActive={false} yAxisId="r" type="monotone" dataKey="quantity" name="Cumulative qty" stroke={GREEN} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Brand + chart colour constants (THEME_SPEC.md §2). */
export const BRAND = { primary: "#635BFF", primaryDark: "#4F46E5", primary50: "#EEF2FF", dark: "#0F172A", sidebar: "#111827" } as const;

/** Recharts series palette, in order. */
export const CHART_COLORS = ["#635BFF", "#2563EB", "#22C55E", "#F59E0B", "#EF4444", "#06B6D4", "#A855F7", "#64748B"] as const;
export const CHART = {
  actual: "#635BFF",
  planned: "#CBD5E1",
  grid: "#E2E8F0",
  axis: "#64748B",
  positive: "#22C55E",
  negative: "#EF4444",
  warning: "#F59E0B",
} as const;
export const MAP_COLORS = { completed: "#22C55E", active: "#635BFF", remaining: "#CBD5E1" } as const;

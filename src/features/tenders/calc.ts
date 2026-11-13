// Pure budget helpers for client components (lib/metrics.ts imports the DB, so it cannot be bundled client-side).
// Formulas mirror SPEC s5: cost = qty x unit cost; price = cost x (1 + markup/100).
import { ENUMS } from "@/lib/status";
import type { BudgetCategory } from "@/lib/types";

export const BUDGET_CATEGORIES = Object.keys(ENUMS.budgetCategory) as BudgetCategory[];

export interface LineInput { quantity: number; unit_cost: number; margin_pct: number }

export function calcLine(l: LineInput): { cost: number; price: number; margin_value: number; margin_on_price: number } {
  const cost = (l.quantity || 0) * (l.unit_cost || 0);
  const price = cost * (1 + (l.margin_pct || 0) / 100);
  const margin_value = price - cost;
  return { cost, price, margin_value, margin_on_price: price > 0 ? (margin_value / price) * 100 : 0 };
}

export function calcTotals(lines: LineInput[]): { cost: number; price: number; margin_value: number; margin_pct: number; markup_pct: number } {
  let cost = 0; let price = 0;
  for (const l of lines) { const a = calcLine(l); cost += a.cost; price += a.price; }
  const margin_value = price - cost;
  return { cost, price, margin_value, margin_pct: price > 0 ? (margin_value / price) * 100 : 0, markup_pct: cost > 0 ? (margin_value / cost) * 100 : 0 };
}

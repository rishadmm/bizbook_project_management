"use client";
import { createContext, useContext } from "react";
import { setBrowserCurrency } from "@/lib/format";

const Ctx = createContext<string>("AED");

/** Mounted by the main, /p and /c layouts. SSR reads the context (useCurrency); the browser module default is set for non-React helpers. */
export default function CurrencyProvider({ currency, children }: { currency: string; children: React.ReactNode }) {
  setBrowserCurrency(currency);
  return <Ctx.Provider value={currency}>{children}</Ctx.Provider>;
}
/** Currency of the surrounding page (active country, the record's country on a detail page, or the portal tenant's country). */
export const useCurrency = (): string => useContext(Ctx);

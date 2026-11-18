import type { RegionProfile } from "./types";
import { uae } from "./uae";
import { oman } from "./oman";

export type { RegionProfile } from "./types";

export const PROFILES: Record<string, RegionProfile> = { uae, oman };
let active: RegionProfile | null = null;

/** Seed order: one database, one company; the UAE profile is seeded first (ids identical to the single-country dataset), then Oman. */
export const SEED_ORDER: RegionProfile[] = [uae, oman];

/** Selects the profile the seed engine (seed-engine, seed-portal, seed-client-portal, seed-invoices, approvals/seed-demo) reads. */
export function setActiveRegion(p: RegionProfile | null): void { active = p; }

/** The profile being seeded (see setActiveRegion); standalone scripts fall back to SEED_REGION (uae | oman, default uae). */
export function getRegionProfile(): RegionProfile {
  if (active) return active;
  const r = (process.env.SEED_REGION ?? "uae").trim().toLowerCase();
  const p = PROFILES[r];
  if (!p) throw new Error(`Unknown SEED_REGION "${r}" (use uae or oman)`);
  return p;
}

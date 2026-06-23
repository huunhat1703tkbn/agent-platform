/**
 * RAG (Red / Amber-Yellow / Green) band classifiers for the KPI norms used by
 * ProjectPlanGuard. The thresholds are the contract in
 * docs/projectplanguard/05-feasibility-rules-and-ds07.md §1 (SETA-08-SOP-001).
 *
 * The `kpi_norms` table seeds the same bands as human-readable text for display;
 * the deterministic feasibility math lives here so it is exact and gradeable.
 * `Yellow` is the catch-all between the explicit Green and Red bands.
 */
export type RagStatus = 'Green' | 'Yellow' | 'Red';

/** N01 Busy Rate = Planned_h / Available_h. Green 85–110, Yellow 111–119, Red >120 or <75. */
export function classifyBusyRate(pct: number): RagStatus {
  if (pct < 75 || pct > 120) return 'Red';
  if (pct >= 85 && pct <= 110) return 'Green';
  return 'Yellow';
}

/** N10 THI = Non-dev_h / Total_h. Green 15–25, Yellow 10–14 / 26–35, Red <10 or >35. */
export function classifyThi(pct: number): RagStatus {
  if (pct < 10 || pct > 35) return 'Red';
  if (pct >= 15 && pct <= 25) return 'Green';
  return 'Yellow';
}

/** N07 On-time Delivery = On-time_MS / Total_MS. Green ≥90, Yellow 70–89, Red <70. */
export function classifyOnTime(pct: number): RagStatus {
  if (pct < 70) return 'Red';
  if (pct >= 90) return 'Green';
  return 'Yellow';
}

/**
 * One-sided capacity-pressure band for a role's *projected peak* demand. Unlike N01
 * (which flags under-utilisation <75% as Red for an individual member), a plan whose
 * busiest role peaks low is simply over-staffed — not infeasible. Only over-allocation
 * is a feasibility risk here: Green ≤110, Yellow 111–120, Red >120.
 */
export function classifyCapacityOverload(pct: number): RagStatus {
  if (pct > 120) return 'Red';
  if (pct > 110) return 'Yellow';
  return 'Green';
}

const RAG_ORDER: Record<RagStatus, number> = { Green: 0, Yellow: 1, Red: 2 };

/** The worst (most severe) status across a set of pillars; null when the set is empty. */
export function ragWorst(statuses: RagStatus[]): RagStatus | null {
  if (statuses.length === 0) return null;
  return statuses.reduce((worst, s) => (RAG_ORDER[s] > RAG_ORDER[worst] ? s : worst));
}
